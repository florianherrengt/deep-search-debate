import { eq } from "drizzle-orm"
import { afterEach, describe, expect, it, vi } from "vitest"
import z from "zod"

import { db } from "../db/index.ts"
import { llmGenerations, user } from "../db/schema/index.ts"
import { generateArrayStream, generateObjectStream } from "./generateText.ts"
import type { TextStreamPersistenceTransaction } from "./streams.ts"
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

function installProviderOutput(text: string): void {
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
  afterEach(() => {
    db.delete(llmGenerations).where(eq(llmGenerations.userId, userId)).run()
    db.update(user).set({ credits: 1_000_000 }).where(eq(user.id, userId)).run()
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
      creditsUsed: 435,
      error: null,
    })
    expect(
      db.select({ credits: user.credits }).from(user).where(eq(user.id, userId)).get()!.credits,
    ).toBe(creditsBefore - 435)
  })

  it("requeries a schema-invalid result as failed without billing or running its hook", async () => {
    const schema = z.object({ answer: z.string().min(1) })
    const onCompleted = vi.fn<ObjectCompletionHook>()
    installProviderOutput(JSON.stringify({ answer: 42 }))
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
    expect(onCompleted).not.toHaveBeenCalled()
    expect(persistedGeneration(generation.id)).toMatchObject({
      status: "failed",
      text: JSON.stringify({ answer: 42 }),
      creditsUsed: null,
      promptName: "default",
    })
    expect(
      db.select({ credits: user.credits }).from(user).where(eq(user.id, userId)).get()!.credits,
    ).toBe(creditsBefore)
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
      creditsUsed: 435,
    })
  })

  it("durably rejects an invalid array element without billing or running its hook", async () => {
    const onCompleted = vi.fn<ArrayCompletionHook>()
    const output = { elements: ["valid", 1] }
    installProviderOutput(JSON.stringify(output))
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
    expect(onCompleted).not.toHaveBeenCalled()
    expect(persistedGeneration(generation.id)).toMatchObject({
      status: "failed",
      text: JSON.stringify(output),
      creditsUsed: null,
      promptName: "generate-websearch-queries",
    })
    expect(
      db.select({ credits: user.credits }).from(user).where(eq(user.id, userId)).get()!.credits,
    ).toBe(creditsBefore)
  })

  it("rejects prototype properties before the durable completion hook", async () => {
    const schema = z.object({ answer: z.string().min(1) })
    const onCompleted = vi.fn<ObjectCompletionHook>()
    installProviderOutput(
      '{"answer":"safe","__proto__":{"polluted":true}}',
    )
    const generation = await generateObjectStream({
      userId,
      owner: { standalone: true },
      prompt: "Answer this",
      promptName: "default",
      schema,
      onCompleted,
    })

    await expect(generation.output).rejects.toThrow(
      "forbidden prototype property",
    )
    await expect(generation.completion).rejects.toThrow(
      "forbidden prototype property",
    )
    expect(onCompleted).not.toHaveBeenCalled()
    expect(persistedGeneration(generation.id)).toMatchObject({
      status: "failed",
      creditsUsed: null,
      promptName: "default",
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
