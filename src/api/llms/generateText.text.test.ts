import {
  completedGenerationHandle,
  llmReservation,
  mockPreparedGeneration,
  mocks,
  resetGenerateTextMocks,
  serverLlmCall,
  subscriptionLlmCall,
} from "./generateText.testSupport.ts"
import { beforeEach, describe, expect, it, vi } from "vitest"
import z from "zod"

import { config } from "../config.ts"
import { FatalCodexContainmentError } from "../openaiConnection/codexSession/process.ts"
import { generateTextStream } from "./generateText.ts"

describe("generateTextStream", () => {
  beforeEach(resetGenerateTextMocks)

  it("does not register a generation aborted while queued", async () => {
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
    expect(mocks.streamText).not.toHaveBeenCalled()
  })

  it("registers and returns every provider stream", async () => {
    const stream = { id: "raw-stream" }
    const finishReason = Promise.resolve("stop" as const)
    const usage = Promise.resolve({ inputTokens: 12, outputTokens: 4 })
    const generation = completedGenerationHandle()
    const prepared = mockPreparedGeneration(generation)
    mocks.loadPrompt.mockResolvedValue("System prompt")
    const rawFinishReason = Promise.resolve("stop")
    mocks.streamText.mockReturnValue({
      stream,
      finishReason,
      rawFinishReason,
      usage,
    })

    const result = await generateTextStream({
      userId: "test-user-id",
      owner: { standalone: true },
      prompt: "Hello",
      promptName: "default",
      reasoning: "enabled",
    })

    expect(mocks.prepareTextGeneration).toHaveBeenCalledOnce()
    const registration = z
      .object({
        onRegistered: z.undefined(),
        onCompleted: z.undefined(),
        onFailed: z.undefined(),
        metadata: z.object({
          modelId: z.literal("configured-model"),
          promptName: z.literal("default"),
          calculateCredits: z.function(),
        }),
      })
      .parse(mocks.prepareTextGeneration.mock.calls[0]?.[2] as unknown)
    expect(registration.metadata.calculateCredits).toBeTypeOf("function")
    expect(prepared.start).toHaveBeenCalledWith(stream, {
      finishReason,
      rawFinishReason,
      usage,
    })
    expect(mocks.streamText).toHaveBeenCalledWith(
      expect.objectContaining({
        maxOutputTokens: config.llmExecution.maxOutputTokens,
        maxRetries: config.llmExecution.maxRetries,
        timeout: {
          totalMs: config.llmExecution.totalTimeoutMs,
          firstChunkMs: config.llmExecution.firstChunkTimeoutMs,
          chunkMs: config.llmExecution.chunkTimeoutMs,
        },
        providerOptions: {
          test: { reasoning: "enabled" },
        },
      }),
    )
    const textCall = z
      .object({ onError: z.function() })
      .parse(mocks.streamText.mock.calls[0]?.[0] as unknown)
    expect(textCall.onError).toBeTypeOf("function")
    expect(mocks.callOptions).toHaveBeenCalledWith("enabled")
    expect(mocks.requirePositiveCreditBalance).toHaveBeenCalledWith(
      "test-user-id",
    )
    expect(result).toBe(generation)
    await expect(result.completion).resolves.toMatchObject({
      status: "completed",
    })
  })

  it("uses a connected subscription without LLM credits and preserves its stream lifecycle", async () => {
    const stream = { id: "raw-codex-stream" }
    const wrappedStream = { id: "wrapped-codex-stream" }
    const finishReason = Promise.resolve("error" as const)
    const rawFinishReason = Promise.resolve("usage_limit_exceeded")
    const usage = Promise.resolve({ inputTokens: 7, outputTokens: 2 })
    const call = subscriptionLlmCall({ wrappedStream })
    const prepared = mockPreparedGeneration()
    mocks.resolveLlmCall.mockResolvedValueOnce(call)
    mocks.loadPrompt.mockResolvedValue("System prompt")
    mocks.streamText.mockReturnValue({
      stream,
      finishReason,
      rawFinishReason,
      usage,
    })

    await generateTextStream({
      userId: "connected-user-id",
      owner: { standalone: true },
      prompt: "Hello",
      promptName: "default",
      reasoning: "enabled",
    })

    expect(mocks.resolveLlmCall).toHaveBeenCalledWith(
      "connected-user-id",
      "enabled",
      undefined,
    )
    expect(mocks.requirePositiveCreditBalance).not.toHaveBeenCalled()
    expect(mocks.callOptions).not.toHaveBeenCalled()
    expect(call.wrapStream).toHaveBeenCalledWith(stream)
    expect(prepared.start).toHaveBeenCalledWith(wrappedStream, {
      finishReason,
      rawFinishReason,
      usage,
    })
    expect(mocks.prepareTextGeneration.mock.calls[0]?.[2]).toMatchObject({
      metadata: {
        modelId: "gpt-5.6-sol",
        promptName: "default",
      },
    })
    expect(
      (
        mocks.prepareTextGeneration.mock.calls[0]?.[2] as {
          metadata: Record<string, unknown>
        }
      ).metadata,
    ).not.toHaveProperty("calculateCredits")
  })

  it("releases a connected subscription when stream startup fails", async () => {
    const release = vi.fn(() => Promise.resolve())
    const call = subscriptionLlmCall({ release })
    const rawSecret = "Provider startup failed: bearer secret-startup-token"
    const failure = new Error(rawSecret)
    const prepared = mockPreparedGeneration()
    mocks.resolveLlmCall.mockResolvedValueOnce(call)
    mocks.loadPrompt.mockResolvedValue("System prompt")
    mocks.streamText.mockImplementationOnce(() => {
      throw failure
    })

    const result = await generateTextStream({
      userId: "connected-user-id",
      owner: { standalone: true },
      prompt: "Hello",
      promptName: "default",
      reasoning: "disabled",
    })

    expect(release).toHaveBeenCalledOnce()
    expect(call.wrapStream).not.toHaveBeenCalled()
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

  it("rethrows fatal containment failure during stream startup cleanup", async () => {
    const fatal = new FatalCodexContainmentError()
    const release = vi.fn(() => Promise.reject(fatal))
    const call = subscriptionLlmCall({ release })
    const prepared = mockPreparedGeneration()
    mocks.resolveLlmCall.mockResolvedValueOnce(call)
    mocks.loadPrompt.mockResolvedValue("System prompt")
    mocks.streamText.mockImplementationOnce(() => {
      throw new Error("Provider startup failed: bearer secret-token")
    })

    await expect(
      generateTextStream({
        userId: "connected-user-id",
        owner: { standalone: true },
        prompt: "Hello",
        promptName: "default",
        reasoning: "disabled",
      }),
    ).rejects.toBe(fatal)

    expect(release).toHaveBeenCalled()
    expect(prepared.fail).not.toHaveBeenCalled()
  })

  it("allows callers to disable provider reasoning", async () => {
    const stream = { id: "raw-stream" }
    mocks.loadPrompt.mockResolvedValue("System prompt")
    mocks.streamText.mockReturnValue({ stream })
    mockPreparedGeneration()

    await generateTextStream({
      userId: "test-user-id",
      owner: { standalone: true },
      prompt: "Critique this idea",
      promptName: "default",
      reasoning: "disabled",
    })

    expect(mocks.streamText).toHaveBeenCalledWith(
      expect.objectContaining({
        providerOptions: {
          test: { reasoning: "disabled" },
        },
      }),
    )
    expect(mocks.callOptions).toHaveBeenCalledWith("disabled")
  })

  it("forwards text-generation persistence hooks", async () => {
    const stream = { id: "raw-stream" }
    const onRegistered = vi.fn()
    const onCompleted = vi.fn()
    const onFailed = vi.fn()
    mocks.loadPrompt.mockResolvedValue("System prompt")
    mocks.streamText.mockReturnValue({ stream })
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
    })

    expect(mocks.prepareTextGeneration).toHaveBeenCalledWith(
      "test-user-id",
      { standalone: true },
      expect.objectContaining({ onRegistered, onCompleted, onFailed }),
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
    expect(mocks.streamText).not.toHaveBeenCalled()
    expect(mocks.release).toHaveBeenCalledOnce()
  })

  it("lets fatal containment cleanup override an outer start failure", async () => {
    const fatal = new FatalCodexContainmentError()
    const release = vi.fn(() => Promise.reject(fatal))
    mocks.resolveLlmCall.mockResolvedValueOnce(
      subscriptionLlmCall({ release }),
    )
    mocks.loadPrompt.mockRejectedValueOnce(new Error("Prompt load failed"))

    await expect(
      generateTextStream({
        userId: "connected-user-id",
        owner: { standalone: true },
        prompt: "Hello",
        promptName: "default",
        reasoning: "disabled",
      }),
    ).rejects.toBe(fatal)

    expect(release).toHaveBeenCalledOnce()
    expect(mocks.prepareTextGeneration).not.toHaveBeenCalled()
    expect(mocks.streamText).not.toHaveBeenCalled()
  })

  it("bounds mixed streaming work with one process-wide queue", async () => {
    mocks.loadPrompt.mockResolvedValue("System prompt")
    const completions = Array.from(
      { length: config.llmExecution.maxConcurrentGenerations + 1 },
      () => Promise.withResolvers<ReturnType<typeof completedGenerationHandle> extends {
        completion: Promise<infer Outcome>
      } ? Outcome : never>(),
    )
    for (const [index, completion] of completions.entries()) {
      mockPreparedGeneration({
        id: `stream-${index}`,
        completion: completion.promise,
      })
      mocks.streamText.mockReturnValueOnce({ stream: { index } })
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
    expect(mocks.streamText).toHaveBeenCalledTimes(
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
    expect(mocks.streamText).toHaveBeenCalledTimes(completions.length)

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
    mockPreparedGeneration({
      id: "server-stream",
      completion: Promise.resolve({
        status: "completed",
        text: "server done",
        reasoning: "",
      }),
    })
    mocks.streamText
      .mockReturnValueOnce({ stream: { id: "connected" } })
      .mockReturnValueOnce({ stream: { id: "server" } })

    const connectedCall = subscriptionLlmCall()
    const serverCall = serverLlmCall("disabled")
    let connectedReservations = 0
    mocks.reserveLlmCall.mockImplementation(
      (userId: string, signal?: AbortSignal) => {
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
    ).resolves.toMatchObject({ id: "server-stream" })
    expect(mocks.streamText).toHaveBeenCalledTimes(2)

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
