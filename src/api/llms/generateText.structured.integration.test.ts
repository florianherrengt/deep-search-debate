import { eq } from "drizzle-orm"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import z from "zod"

import { researchPlanSchema } from "../agents/deep_search/schemas.ts"
import { selectPageLinks } from "../agents/deep_search/selection.ts"
import { db } from "../db/index.ts"
import { deepSearchJobs, llmGenerations, llmModelSettings, user } from "../db/schema/index.ts"
import { deleteDeepSeekApiKey, setDeepSeekApiKey } from "../deepseekConnection/keysRepository.ts"
import { ideaSchema } from "../routes/ideas/schemas.ts"
import { generateArrayStream, generateObjectStream } from "./generateText.ts"
import { replaceLlmModelAssignments } from "./modelSettings.ts"
import { subscribeToTextStream, type TextStreamPersistenceTransaction, type TextStreamEvent } from "./streams.ts"
import type { LlmUsage } from "./streamTypes.ts"

const userId = "test-user-id"

type ObjectCompletionHook = (
  completed: { id: string; output: { answer: string } },
  transaction: TextStreamPersistenceTransaction,
) => void
type ArrayCompletionHook = (
  completed: { id: string; output: string[] },
  transaction: TextStreamPersistenceTransaction,
) => void

function usage(): LlmUsage {
  return {
    inputTokens: 1_000_000,
    inputTokenDetails: {
      noCacheTokens: 1_000_000,
      cacheReadTokens: 0,
      cacheWriteTokens: 0,
    },
    outputTokens: 0,
    outputTokenDetails: { textTokens: 0, reasoningTokens: 0 },
    totalTokens: 1_000_000,
  }
}

function installProviderOutput(text: string) {
  const fetch = vi.fn<typeof globalThis.fetch>(async (input, init) => {
    const request = new Request(input, init)
    expect(request.url).toBe("https://api.deepseek.com/chat/completions")
    const payload = JSON.parse(await request.text()) as Record<string, unknown>
    expect(payload).toMatchObject({
      model: "deepseek-v4-pro",
      stream: true,
      response_format: { type: "json_object" },
    })
    const chunks = [
      { choices: [{ index: 0, delta: { content: text }, finish_reason: null }] },
      {
        choices: [{ index: 0, delta: {}, finish_reason: "stop" }],
        usage: {
          prompt_tokens: usage().inputTokens,
          completion_tokens: usage().outputTokens,
          total_tokens: usage().totalTokens,
        },
      },
    ]
    return new Response(
      `${chunks.map((chunk) => `data: ${JSON.stringify(chunk)}\n\n`).join("")}data: [DONE]\n\n`,
      { headers: { "content-type": "text/event-stream" } },
    )
  })
  vi.stubGlobal("fetch", fetch)
  return fetch
}

function persistedGeneration(id: string) {
  return db
    .select({
      status: llmGenerations.status,
      text: llmGenerations.text,
      reasoning: llmGenerations.reasoning,
      error: llmGenerations.error,
      creditsUsed: llmGenerations.creditsUsed,
      promptName: llmGenerations.promptName,
    })
    .from(llmGenerations)
    .where(eq(llmGenerations.llmGenerationId, id))
    .get()
}

describe("structured generation persistence integration", () => {
  beforeEach(() => {
    setDeepSeekApiKey(userId, "test-deepseek-api-key")
    replaceLlmModelAssignments(userId, {
      small: {
        provider: "deepseek",
        modelId: "deepseek-v4-pro",
        reasoningEffort: "none",
      },
      big: {
        provider: "deepseek",
        modelId: "deepseek-v4-pro",
        reasoningEffort: "none",
      },
    })
  })

  afterEach(() => {
    db.delete(llmGenerations).where(eq(llmGenerations.userId, userId)).run()
    db.delete(deepSearchJobs).where(eq(deepSearchJobs.userId, userId)).run()
    db.delete(llmModelSettings).where(eq(llmModelSettings.userId, userId)).run()
    deleteDeepSeekApiKey(userId)
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
  })

  it("durably settles valid structured output and commits its hook atomically", async () => {
    const schema = z.object({ answer: z.string().min(1) })
    const output = { answer: "persisted answer" }
    const creditsBefore = db
      .select({ credits: user.credits })
      .from(user)
      .where(eq(user.id, userId))
      .get()!.credits
    const onCompleted = vi.fn<ObjectCompletionHook>((completed, transaction) => {
      transaction
        .update(llmGenerations)
        .set({ promptName: `completed:${completed.output.answer}` })
        .where(eq(llmGenerations.llmGenerationId, completed.id))
        .run()
    })
    installProviderOutput(JSON.stringify(output))

    const generation = await generateObjectStream({
      userId,
      owner: { standalone: true },
      prompt: "Answer this",
      promptName: "default",
      schema,
      onCompleted,
    })

    await expect(generation.output).resolves.toEqual(output)
    await expect(generation.completion).resolves.toMatchObject({
      status: "completed",
      text: JSON.stringify(output),
    })
    expect(onCompleted).toHaveBeenCalledOnce()
    expect(persistedGeneration(generation.id)).toMatchObject({
      status: "completed",
      text: JSON.stringify(output),
      reasoning: "",
      promptName: "completed:persisted answer",
      creditsUsed: 0,
      error: null,
    })
    expect(
      db.select({ credits: user.credits }).from(user).where(eq(user.id, userId)).get()!.credits,
    ).toBe(creditsBefore)
  })

  it("sends canonical requirement field guidance and durably completes mixed discovery requirements", async () => {
    const output = {
      version: 1,
      requirements: [
        {
          requirement: "Must run locally on an M1 Max",
          kind: "requirement",
          status: "unresolved",
          sources: [],
          explanation: "The user made local execution mandatory.",
        },
        {
          requirement: "Prefer an open source license",
          kind: "preference",
          status: "unresolved",
          sources: [],
          explanation: "The user expressed a preference for open source.",
        },
      ],
      queries: ["agentic LLMs for Apple M1 Max local inference"],
    }
    const text = JSON.stringify(output)
    const fetch = installProviderOutput(text)
    const generation = await generateObjectStream({
      userId,
      owner: { standalone: true },
      prompt: "Best local agentic LLM for M1 Max",
      promptName: "generate-discovery-queries",
      schema: researchPlanSchema.extend({
        queries: z.array(z.string().trim().min(1).max(500)).length(1),
      }),
      onCompleted: (completed, transaction) => {
        transaction
          .update(llmGenerations)
          .set({ promptName: `completed:${completed.output.queries.join("|")}` })
          .where(eq(llmGenerations.llmGenerationId, completed.id))
          .run()
      },
    })

    await expect(generation.output).resolves.toEqual(output)
    await expect(generation.completion).resolves.toMatchObject({
      status: "completed",
      text,
    })

    const [input, init] = fetch.mock.calls[0]
    const request = new Request(input, init)
    const payload = JSON.parse(await request.text()) as {
      messages: Array<{ role: string; content: string }>
    }
    const systemPrompt = payload.messages.find(({ role }) => role === "system")?.content
    expect(systemPrompt).toContain('"description"')
    expect(systemPrompt).toMatch(/"requirement"\s*:\s*\{[^}]*"description"\s*:\s*"[^"]*(?:preference|kind)[^"]*"/i)

    expect(persistedGeneration(generation.id)).toMatchObject({
      status: "completed",
      text,
      promptName: `completed:${output.queries.join("|")}`,
      error: null,
    })
  })

  it("requeries a schema-invalid result as failed without billing or running its hook", async () => {
    const schema = z.object({ answer: z.string().min(1) })
    const onCompleted = vi.fn<ObjectCompletionHook>()
    const fetch = installProviderOutput(JSON.stringify({ answer: 42 }))
    const creditsBefore = db
      .select({ credits: user.credits })
      .from(user)
      .where(eq(user.id, userId))
      .get()!.credits

    const generation = await generateObjectStream({
      userId,
      owner: { standalone: true },
      prompt: "Answer this",
      promptName: "default",
      schema,
      onCompleted,
    })

    await expect(generation.output).rejects.toBeInstanceOf(z.ZodError)
    await expect(generation.completion).rejects.toBeInstanceOf(z.ZodError)
    await expect(generation.output).rejects.toThrow(
      "Text generation failed because the model's response did not match the required format.",
    )
    expect(fetch).toHaveBeenCalledOnce()
    expect(onCompleted).not.toHaveBeenCalled()
    expect(persistedGeneration(generation.id)).toMatchObject({
      status: "failed",
      text: JSON.stringify({ answer: 42 }),
      creditsUsed: null,
      promptName: "default",
      error: "Text generation failed because the model's response did not match the required format.",
    })
    expect(
      db.select({ credits: user.credits }).from(user).where(eq(user.id, userId)).get()!.credits,
    ).toBe(creditsBefore)
  })

  it.each([
    { mode: "research" as const, invalid: "unknown", issueCode: "invalid_value", issueCount: 3,
      message: "Linked-source selection failed because the model returned link IDs that were not supplied." },
    { mode: "discovery" as const, invalid: "unknown", issueCode: "invalid_value", issueCount: 3,
      message: "Linked-source selection failed because the model returned link IDs that were not supplied." },
    { mode: "research" as const, invalid: "duplicate", issueCode: "custom", issueCount: 1,
      message: "Linked-source selection failed because the model's response did not match the required format." },
  ])("reports $invalid $mode link selections consistently without repairing or retrying them", async ({ mode, invalid, issueCode, issueCount, message }) => {
    const deepSearchJobId = crypto.randomUUID()
    db.insert(deepSearchJobs).values({
      deepSearchJobId, userId, slug: deepSearchJobId, researchRequest: "Find Steam Deck games",
      maxSearches: 1, maxResultsPerSearch: 3, maxRounds: 1, strictQuality: false,
    }).run()
    const links = ["457140", "1621690", "1169040"].map((appId) => ({
      id: crypto.randomUUID(), url: `https://store.steampowered.com/app/${appId}/`, title: "Game",
    }))
    const selectedIds = invalid === "unknown"
      ? ["457140", "1621690", "1169040"]
      : [links[0].id, links[0].id]
    const text = JSON.stringify({ selectedIds })
    const fetch = installProviderOutput(text)
    const errorLog = vi.spyOn(console, "error").mockImplementation(() => undefined)
    const creditsBefore = db.select({ credits: user.credits }).from(user).where(eq(user.id, userId)).get()!.credits
    const onCompleted = vi.fn()
    const generation = await selectPageLinks({
      userId, deepSearchJobId, mode, userQuery: "Find Steam Deck games",
      sourceUrl: "https://example.com/games", sourceSummary: "Find related games.", links,
      maxResultsToExplore: 3, onCompleted,
    })
    const liveEvents = subscribeToTextStream(generation.streamId)!
    const selectionFailure = generation.selectedIds.catch((failure: unknown) => failure)
    const error = await generation.completion.catch((failure: unknown) => failure)
    const selectedError = await selectionFailure
    expect(error).toBeInstanceOf(z.ZodError)
    expect(error).toHaveProperty("message", message)
    expect(error).toHaveProperty("issues", expect.arrayContaining([
      expect.objectContaining({ code: issueCode }),
    ]))
    expect(selectedError).toBe(error)
    expect(fetch).toHaveBeenCalledOnce()
    expect(onCompleted).not.toHaveBeenCalled()
    expect(persistedGeneration(generation.streamId)).toMatchObject({
      status: "failed", text, error: message, creditsUsed: null,
    })
    expect(db.select({ credits: user.credits }).from(user).where(eq(user.id, userId)).get()!.credits).toBe(creditsBefore)
    const expectedEvents = [{ type: "text", text }, { type: "error", message }, { type: "done" }]
    const observedLive: TextStreamEvent[] = []
    for await (const event of liveEvents) observedLive.push(event)
    expect(observedLive).toEqual(expectedEvents)

    // This saved row has no retained live log, so its read exercises database replay.
    const savedId = crypto.randomUUID()
    const saved = db.select().from(llmGenerations).where(eq(llmGenerations.llmGenerationId, generation.streamId)).get()!
    db.insert(llmGenerations).values({ ...saved, llmGenerationId: savedId }).run()
    const observedReplay: TextStreamEvent[] = []
    for await (const event of subscribeToTextStream(savedId)!) observedReplay.push(event)
    expect(observedReplay).toEqual(expectedEvents)
    expect(errorLog).toHaveBeenCalledOnce()
    expect(JSON.parse(String(errorLog.mock.calls[0]?.[0])) as unknown).toMatchObject({
      event: "llm_generation_failed", generationId: generation.streamId, deepSearchJobId,
      failure: { category: "validation", name: "ZodError", issueCount, issueCodes: [issueCode] },
    })
    expect(String(errorLog.mock.calls[0]?.[0])).not.toContain("457140")
  })

  it("persists a 5,000-character refine-idea description through structured validation", async () => {
    const output = {
      title: "Useful idea",
      description: "d".repeat(5_000),
    }
    const text = JSON.stringify(output)
    installProviderOutput(text)

    const generation = await generateObjectStream({
      userId,
      owner: { standalone: true },
      prompt: "Refine this idea",
      promptName: "refine-idea",
      schema: ideaSchema,
    })
    const [parsedOutput, completion] = await Promise.allSettled([
      generation.output,
      generation.completion,
    ])

    expect(persistedGeneration(generation.id)).toMatchObject({
      status: "completed",
      text,
      promptName: "refine-idea",
      error: null,
    })
    expect(parsedOutput).toEqual({ status: "fulfilled", value: output })
    expect(completion).toMatchObject({
      status: "fulfilled",
      value: { status: "completed", text },
    })
  })

  it("settles a validated array result and passes the parsed output to its hook", async () => {
    const onCompleted = vi.fn<
      (
        completed: { id: string; output: string[] },
        transaction: TextStreamPersistenceTransaction,
      ) => void
    >((completed, transaction) => {
      transaction
        .update(llmGenerations)
        .set({ promptName: `array:${completed.output.join("|")}` })
        .where(eq(llmGenerations.llmGenerationId, completed.id))
        .run()
    })
    const output = { elements: ["first", "second"] }
    installProviderOutput(JSON.stringify(output))

    const generation = await generateArrayStream({
      userId,
      owner: { standalone: true },
      prompt: "List answers",
      promptName: "generate-websearch-queries",
      element: z.string().min(1),
      onCompleted,
    })

    await expect(generation.output).resolves.toEqual(output.elements)
    await expect(generation.completion).resolves.toMatchObject({
      status: "completed",
      text: JSON.stringify(output),
    })
    expect(onCompleted).toHaveBeenCalledOnce()
    expect(persistedGeneration(generation.id)).toMatchObject({
      status: "completed",
      promptName: "array:first|second",
      creditsUsed: 0,
    })
  })

  it("durably rejects an invalid array element without billing or running its hook", async () => {
    const onCompleted = vi.fn<ArrayCompletionHook>()
    const output = { elements: ["valid", 1] }
    const fetch = installProviderOutput(JSON.stringify(output))
    const creditsBefore = db
      .select({ credits: user.credits })
      .from(user)
      .where(eq(user.id, userId))
      .get()!.credits

    const generation = await generateArrayStream({
      userId,
      owner: { standalone: true },
      prompt: "List answers",
      promptName: "generate-websearch-queries",
      element: z.string().min(1),
      onCompleted,
    })

    await expect(generation.output).rejects.toBeInstanceOf(z.ZodError)
    await expect(generation.completion).rejects.toBeInstanceOf(z.ZodError)
    await expect(generation.output).rejects.toThrow(
      "Research planning failed because the model's response did not match the required format.",
    )
    expect(fetch).toHaveBeenCalledOnce()
    expect(onCompleted).not.toHaveBeenCalled()
    expect(persistedGeneration(generation.id)).toMatchObject({
      status: "failed",
      text: JSON.stringify(output),
      creditsUsed: null,
      promptName: "generate-websearch-queries",
      error: "Research planning failed because the model's response did not match the required format.",
    })
    expect(
      db.select({ credits: user.credits }).from(user).where(eq(user.id, userId)).get()!.credits,
    ).toBe(creditsBefore)
  })

  it("persists a generated idea with a 5,000-character description", async () => {
    const output = {
      elements: [{
        title: "Useful idea",
        description: "d".repeat(5_000),
      }],
    }
    const text = JSON.stringify(output)
    installProviderOutput(text)

    const generation = await generateArrayStream({
      userId,
      owner: { standalone: true },
      prompt: "Generate ideas",
      promptName: "generate-ideas",
      element: ideaSchema,
    })
    const [parsedOutput, completion] = await Promise.allSettled([
      generation.output,
      generation.completion,
    ])

    expect(persistedGeneration(generation.id)).toMatchObject({
      status: "completed",
      text,
      promptName: "generate-ideas",
      error: null,
    })
    expect(parsedOutput).toEqual({ status: "fulfilled", value: output.elements })
    expect(completion).toMatchObject({
      status: "fulfilled",
      value: { status: "completed", text },
    })
  })

  it.each([
    '{"answer":',
    '{"answer":"safe","__proto__":{"polluted":true}}',
  ])("rejects unreadable JSON before the durable completion hook: %s", async (text) => {
    const schema = z.object({ answer: z.string().min(1) })
    const onCompleted = vi.fn<ObjectCompletionHook>()
    const fetch = installProviderOutput(text)
    const errorLog = vi.spyOn(console, "error").mockImplementation(() => undefined)
    const generation = await generateObjectStream({
      userId,
      owner: { standalone: true },
      prompt: "Answer this",
      promptName: "default",
      schema,
      onCompleted,
    })

    await expect(generation.output).rejects.toBeInstanceOf(SyntaxError)
    await expect(generation.output).rejects.toThrow(
      "Text generation failed because the model returned a response that could not be read as JSON.",
    )
    await expect(generation.completion).rejects.toBeInstanceOf(SyntaxError)
    expect(fetch).toHaveBeenCalledOnce()
    expect(onCompleted).not.toHaveBeenCalled()
    expect(persistedGeneration(generation.id)).toMatchObject({
      status: "failed",
      creditsUsed: null,
      promptName: "default",
      text,
      error: "Text generation failed because the model returned a response that could not be read as JSON.",
    })
    expect(JSON.parse(String(errorLog.mock.calls[0]?.[0])) as unknown).toMatchObject({
      failure: { category: "invalid-json", name: "SyntaxError" },
    })
  })

  it("rolls back settlement and hook writes when the completion hook fails", async () => {
    const schema = z.object({ answer: z.string().min(1) })
    const output = { answer: "hook rollback" }
    const onCompleted = vi.fn<ObjectCompletionHook>((completed, transaction) => {
      transaction
        .update(llmGenerations)
        .set({ promptName: `rolled-back:${completed.output.answer}` })
        .where(eq(llmGenerations.llmGenerationId, completed.id))
        .run()
      throw new Error("completion hook failed")
    })
    installProviderOutput(JSON.stringify(output))
    const creditsBefore = db
      .select({ credits: user.credits })
      .from(user)
      .where(eq(user.id, userId))
      .get()!.credits

    const generation = await generateObjectStream({
      userId,
      owner: { standalone: true },
      prompt: "Answer this",
      promptName: "default",
      schema,
      onCompleted,
    })

    await expect(generation.output).rejects.toThrow("completion hook failed")
    await expect(generation.completion).rejects.toThrow("completion hook failed")
    expect(onCompleted).toHaveBeenCalledOnce()
    expect(persistedGeneration(generation.id)).toMatchObject({
      status: "failed",
      text: JSON.stringify(output),
      error: "completion hook failed",
      creditsUsed: null,
      promptName: "default",
    })
    expect(
      db.select({ credits: user.credits }).from(user).where(eq(user.id, userId)).get()!.credits,
    ).toBe(creditsBefore)
  })
})
