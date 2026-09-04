import {
  completedGenerationHandle,
  llmReservation,
  mockPreparedGeneration,
  mocks,
  resetGenerateTextMocks,
  serverLlmCall,
  startedLlmStream,
  subscriptionLlmCall,
} from "./generateText.testSupport.ts"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import z from "zod"

import { config } from "../config.ts"
import { db } from "../db/index.ts"
import { llmModelSettings } from "../db/schema/index.ts"
import { generateTextStream } from "./generateText.ts"
import { replaceLlmModelAssignments } from "./modelSettings.ts"

describe("generateTextStream", () => {
  beforeEach(() => {
    resetGenerateTextMocks()
    db.delete(llmModelSettings).run()
  })
  afterEach(() => {
    db.delete(llmModelSettings).run()
  })

  it("does not register or start a generation aborted while queued", async () => {
    const controller = new AbortController()
    controller.abort({ _tag: "WorkflowAbortReason", reason: "user-stop" })
    mocks.loadPrompt.mockResolvedValue("System prompt")

    await expect(
      generateTextStream({
        userId: "test-user-id",
        owner: { standalone: true },
        prompt: "Hello",
        promptName: "default",
        reasoning: "enabled",
        workflowSignal: controller.signal,
      }),
    ).rejects.toThrow()

    expect(mocks.prepareTextGeneration).not.toHaveBeenCalled()
    expect(mocks.start).not.toHaveBeenCalled()
  })

  it("registers the selected provider and starts Pi with the bounded request", async () => {
    const started = startedLlmStream()
    const generation = completedGenerationHandle()
    const prepared = mockPreparedGeneration(generation)
    mocks.loadPrompt.mockResolvedValue("System prompt")
    mocks.start.mockReturnValue(started)

    const result = await generateTextStream({
      userId: "test-user-id",
      owner: { standalone: true },
      prompt: "Hello",
      promptName: "default",
      reasoning: "enabled",
      maxOutputTokens: config.llmExecution.maxOutputTokens + 1_000,
      temperature: 0.25,
    })

    const registration = z
      .object({
        onRegistered: z.undefined(),
        onCompleted: z.undefined(),
        onFailed: z.undefined(),
        metadata: z.object({
          modelId: z.literal("deepseek-v4-pro"),
          promptName: z.literal("default"),
          provider: z.literal("server"),
          calculateCredits: z.function(),
        }),
      })
      .parse(mocks.prepareTextGeneration.mock.calls[0]?.[2] as unknown)
    expect(registration.metadata.calculateCredits).toBeTypeOf("function")
    expect(mocks.start).toHaveBeenCalledWith({
      prompt: "Hello",
      system: "System prompt",
      temperature: 0.25,
      maxOutputTokens: config.llmExecution.maxOutputTokens,
      workflowSignal: undefined,
    })
    expect(prepared.start).toHaveBeenCalledWith(started.stream, {
      finishReason: started.finishReason,
      rawFinishReason: started.rawFinishReason,
      usage: started.usage,
    })
    expect(mocks.requirePositiveCreditBalance).toHaveBeenCalledWith(
      "test-user-id",
    )
    expect(result).toBe(generation)
    await expect(result.completion).resolves.toMatchObject({
      status: "completed",
    })
  })

  it("uses a connected Codex subscription without charging LLM credits", async () => {
    const started = startedLlmStream({
      finishReason: Promise.resolve("error"),
      rawFinishReason: Promise.resolve("usage_limit_exceeded"),
    })
    const start = vi.fn(() => started)
    const call = subscriptionLlmCall({ start })
    const prepared = mockPreparedGeneration()
    mocks.resolveLlmCall.mockResolvedValueOnce(call)
    mocks.loadPrompt.mockResolvedValue("System prompt")

    await generateTextStream({
      userId: "connected-user-id",
      owner: { standalone: true },
      prompt: "Hello",
      promptName: "default",
      reasoning: "enabled",
    })

    expect(mocks.requirePositiveCreditBalance).not.toHaveBeenCalled()
    expect(start).toHaveBeenCalledWith({
      prompt: "Hello",
      system: "System prompt",
      temperature: undefined,
      maxOutputTokens: config.llmExecution.maxOutputTokens,
      workflowSignal: undefined,
    })
    expect(prepared.start).toHaveBeenCalledWith(started.stream, {
      finishReason: started.finishReason,
      rawFinishReason: started.rawFinishReason,
      usage: started.usage,
    })
    const metadata = (
      mocks.prepareTextGeneration.mock.calls[0]?.[2] as {
        metadata: Record<string, unknown>
      }
    ).metadata
    expect(metadata).toMatchObject({
      modelId: "gpt-5.6-sol",
      promptName: "default",
      provider: "codex",
    })
    expect(metadata).not.toHaveProperty("calculateCredits")
  })

  it("sanitizes a Codex startup failure before persistence", async () => {
    const release = vi.fn(() => Promise.resolve())
    const rawSecret = "Provider startup failed: bearer secret-startup-token"
    const start = vi.fn(() => {
      throw new Error(rawSecret)
    })
    const call = subscriptionLlmCall({ start, release })
    const prepared = mockPreparedGeneration()
    mocks.resolveLlmCall.mockResolvedValueOnce(call)
    mocks.loadPrompt.mockResolvedValue("System prompt")

    const result = await generateTextStream({
      userId: "connected-user-id",
      owner: { standalone: true },
      prompt: "Hello",
      promptName: "default",
      reasoning: "disabled",
    })

    expect(release).toHaveBeenCalled()
    expect(prepared.start).not.toHaveBeenCalled()
    expect(prepared.fail).toHaveBeenCalledWith(
      expect.objectContaining({
        name: "OpenAiCodexError",
        code: "temporarily-unavailable",
        message: "OpenAI Codex is temporarily unavailable. Try again later.",
      }),
    )
    expect(JSON.stringify(prepared.fail.mock.calls)).not.toContain(rawSecret)
    expect(result).toMatchObject({ id: "stream-id" })
  })

  it("routes Small and Big prompts using their snapshotted assignments", async () => {
    replaceLlmModelAssignments("test-user-id", {
      small: {
        provider: "deepseek",
        modelId: "deepseek-v4-pro",
        reasoningEffort: "none",
      },
      big: {
        provider: "deepseek",
        modelId: "deepseek-v4-flash",
        reasoningEffort: "high",
      },
    })
    mocks.loadPrompt.mockResolvedValue("System prompt")

    mockPreparedGeneration()
    await generateTextStream({
      userId: "test-user-id",
      owner: { standalone: true },
      prompt: "Summarize this page",
      promptName: "summarize-web-page",
      reasoning: "enabled",
    })
    mockPreparedGeneration()
    await generateTextStream({
      userId: "test-user-id",
      owner: { standalone: true },
      prompt: "Debate this",
      promptName: "default",
      reasoning: "disabled",
    })

    expect(mocks.reserveLlmCall).toHaveBeenNthCalledWith(
      1,
      "test-user-id",
      {
        role: "small",
        assignment: {
          provider: "deepseek",
          modelId: "deepseek-v4-pro",
          reasoningEffort: "none",
        },
        explicit: true,
      },
      undefined,
    )
    expect(mocks.reserveLlmCall).toHaveBeenNthCalledWith(
      2,
      "test-user-id",
      {
        role: "big",
        assignment: {
          provider: "deepseek",
          modelId: "deepseek-v4-flash",
          reasoningEffort: "high",
        },
        explicit: true,
      },
      undefined,
    )
    expect(mocks.resolveLlmCall.mock.calls.map(([, snapshot]) => snapshot.assignment.modelId)).toEqual([
      "deepseek-v4-pro",
      "deepseek-v4-flash",
    ])
  })

  it("forwards text-generation persistence hooks", async () => {
    const onRegistered = vi.fn()
    const onCompleted = vi.fn()
    const onFailed = vi.fn()
    const onInterrupted = vi.fn()
    mocks.loadPrompt.mockResolvedValue("System prompt")
    mockPreparedGeneration()

    await generateTextStream({
      userId: "test-user-id",
      owner: { standalone: true },
      prompt: "Hello",
      promptName: "default",
      reasoning: "enabled",
      onRegistered,
      onCompleted,
      onFailed,
      onInterrupted,
    })

    expect(mocks.prepareTextGeneration).toHaveBeenCalledWith(
      "test-user-id",
      { standalone: true },
      expect.objectContaining({
        onRegistered,
        onCompleted,
        onFailed,
        onInterrupted,
      }),
    )
  })

  it("does not start provider work when durable registration fails", async () => {
    mocks.loadPrompt.mockResolvedValue("System prompt")
    mocks.prepareTextGeneration.mockImplementationOnce(() => {
      throw new Error("Stage registration failed")
    })

    await expect(
      generateTextStream({
        userId: "test-user-id",
        owner: { standalone: true },
        prompt: "Hello",
        promptName: "default",
        reasoning: "disabled",
      }),
    ).rejects.toThrow("Stage registration failed")
    expect(mocks.start).not.toHaveBeenCalled()
    expect(mocks.release).toHaveBeenCalledOnce()
  })

  it("bounds mixed streaming work with one process-wide queue", async () => {
    mocks.loadPrompt.mockResolvedValue("System prompt")
    const completions = Array.from(
      { length: config.llmExecution.maxConcurrentGenerations + 1 },
      () => Promise.withResolvers<
        Awaited<ReturnType<typeof completedGenerationHandle>["completion"]>
      >(),
    )
    for (const [index, completion] of completions.entries()) {
      mockPreparedGeneration({
        id: `stream-${index}`,
        completion: completion.promise,
      })
    }

    const starts = completions.map((_, index) =>
      generateTextStream({
        userId: "test-user-id",
        owner: { standalone: true },
        prompt: `Request ${index}`,
        promptName: "default",
        reasoning: "disabled",
      }),
    )
    await Promise.all(
      starts.slice(0, config.llmExecution.maxConcurrentGenerations),
    )
    expect(mocks.start).toHaveBeenCalledTimes(
      config.llmExecution.maxConcurrentGenerations,
    )

    completions[0].resolve({
      status: "completed",
      text: "done",
      reasoning: "",
    })
    await expect(starts.at(-1)).resolves.toMatchObject({
      id: `stream-${completions.length - 1}`,
    })
    expect(mocks.start).toHaveBeenCalledTimes(completions.length)

    for (const completion of completions.slice(1)) {
      completion.resolve({ status: "completed", text: "done", reasoning: "" })
    }
  })

  it("does not spend shared generation permits on same-user Codex waiters", async () => {
    mocks.loadPrompt.mockResolvedValue("System prompt")
    const firstCompletion = Promise.withResolvers<
      Awaited<ReturnType<typeof completedGenerationHandle>["completion"]>
    >()
    mockPreparedGeneration({
      id: "connected-stream",
      completion: firstCompletion.promise,
    })
    mockPreparedGeneration(completedGenerationHandle("server done"))

    const connectedCall = subscriptionLlmCall()
    const serverCall = serverLlmCall("deepseek-v4-pro")
    let connectedReservations = 0
    mocks.reserveLlmCall.mockImplementation(
      (userId: string, _snapshot: unknown, signal?: AbortSignal) => {
        if (userId === "connected-user") {
          connectedReservations += 1
          if (connectedReservations === 1) {
            return Promise.resolve(llmReservation(connectedCall))
          }
          return new Promise((_resolve, reject) => {
            const onAbort = () =>
              reject(
                signal?.reason instanceof Error
                  ? signal.reason
                  : new Error("Stopped queued Codex request"),
              )
            signal?.addEventListener("abort", onAbort, { once: true })
          })
        }
        return Promise.resolve(llmReservation(serverCall))
      },
    )

    const first = await generateTextStream({
      userId: "connected-user",
      owner: { standalone: true },
      prompt: "First",
      promptName: "default",
      reasoning: "disabled",
    })
    const waitingControllers = Array.from(
      { length: config.llmExecution.maxConcurrentGenerations - 1 },
      () => new AbortController(),
    )
    const waiting = waitingControllers.map((controller, index) =>
      generateTextStream({
        userId: "connected-user",
        owner: { standalone: true },
        prompt: `Waiting ${index}`,
        promptName: "default",
        reasoning: "disabled",
        workflowSignal: controller.signal,
      }),
    )

    await expect(
      generateTextStream({
        userId: "server-user",
        owner: { standalone: true },
        prompt: "Server funded",
        promptName: "default",
        reasoning: "disabled",
      }),
    ).resolves.toMatchObject({ id: "stream-id" })
    expect(mocks.prepareTextGeneration).toHaveBeenCalledTimes(2)

    for (const controller of waitingControllers) {
      controller.abort(new Error("Stop queued Codex request"))
    }
    await Promise.all(waiting.map((promise) => promise.catch(() => undefined)))
    firstCompletion.resolve({
      status: "completed",
      text: "connected done",
      reasoning: "",
    })
    await first.completion
  })
})
