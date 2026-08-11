import { afterEach, describe, expect, it, vi } from "vitest"
import { eq } from "drizzle-orm"
import type { streamText } from "ai"
import z from "zod"
import { db } from "../db/index.ts"
import { deepSearchJobs, llmGenerations } from "../db/schema/index.ts"
import {
  awaitGenerationOutput,
  awaitGenerationText,
  registerTextStream,
  subscribeToTextStream,
  type TextStreamEvent,
} from "./streams.ts"

type SourceStreamPart = ReturnType<
  typeof streamText
>["stream"] extends AsyncIterable<infer Part>
  ? Part
  : never

class AsyncQueue<T> implements AsyncIterable<T> {
  private readonly values: T[] = []
  private readonly waiters: Array<(result: IteratorResult<T>) => void> = []
  private closed = false

  push(value: T): void {
    const waiter = this.waiters.shift()
    if (waiter) waiter({ value, done: false })
    else this.values.push(value)
  }

  close(): void {
    this.closed = true
    for (const waiter of this.waiters.splice(0)) {
      waiter({ value: undefined, done: true })
    }
  }

  [Symbol.asyncIterator](): AsyncIterator<T> {
    return {
      next: () => {
        const value = this.values.shift()
        if (value !== undefined) {
          return Promise.resolve({ value, done: false })
        }
        if (this.closed) {
          return Promise.resolve({ value: undefined, done: true })
        }
        return new Promise((resolve) => this.waiters.push(resolve))
      },
    }
  }
}

async function drain(
  stream: AsyncGenerator<TextStreamEvent>,
): Promise<TextStreamEvent[]> {
  const events: TextStreamEvent[] = []
  for await (const event of stream) events.push(event)
  return events
}

describe("text streams", () => {
  afterEach(() => vi.restoreAllMocks())

  it("waits for durable completion before exposing structured output errors", async () => {
    const completion = Promise.withResolvers<{
      status: "completed"
      text: string
      reasoning: string
    }>()
    const result = awaitGenerationOutput(
      { id: "generation-id", completion: completion.promise },
      Promise.reject(new Error("Structured output was invalid")),
    )
    let settled = false
    void result.then(
      () => {
        settled = true
      },
      () => {
        settled = true
      },
    )

    await Promise.resolve()
    expect(settled).toBe(false)

    completion.resolve({
      status: "completed",
      text: "raw output",
      reasoning: "",
    })
    await expect(result).rejects.toThrow("Structured output was invalid")
  })

  it("converts a durable failed outcome into an internal text error", async () => {
    await expect(
      awaitGenerationText({
        id: "generation-id",
        completion: Promise.resolve({
          status: "failed",
          text: "partial output",
          reasoning: "partial reasoning",
          error: "Provider failed",
          failureKind: "stream",
        }),
      }),
    ).rejects.toThrow("Provider failed")
  })

  it("replays buffered events before following live events", async () => {
    const source = new AsyncQueue<SourceStreamPart>()
    const { id, completion } = registerTextStream(
      "test-user-id",
      { standalone: true },
      source,
    )
    source.push({ type: "reasoning-delta", id: "reasoning", text: "Think" })
    await Promise.resolve()

    const stream = subscribeToTextStream(id)
    expect(stream).toBeDefined()
    await expect(stream!.next()).resolves.toEqual({
      value: { type: "reasoning", text: "Think" },
      done: false,
    })

    const next = stream!.next()
    source.push({ type: "text-delta", id: "text", text: "Answer" })
    await expect(next).resolves.toEqual({
      value: { type: "text", text: "Answer" },
      done: false,
    })

    source.close()
    await expect(stream!.next()).resolves.toEqual({
      value: { type: "done" },
      done: false,
    })
    await expect(completion).resolves.toEqual({
      status: "completed",
      text: "Answer",
      reasoning: "Think",
    })
  })

  it("supports concurrent readers and repeated completed reads", async () => {
    const source = new AsyncQueue<SourceStreamPart>()
    const { id, completion } = registerTextStream(
      "test-user-id",
      { standalone: true },
      source,
    )
    const first = subscribeToTextStream(id)
    const second = subscribeToTextStream(id)
    expect(first).toBeDefined()
    expect(second).toBeDefined()

    const firstNext = first!.next()
    const secondNext = second!.next()
    source.push({ type: "text-delta", id: "text", text: "Shared" })
    await expect(firstNext).resolves.toMatchObject({
      value: { type: "text", text: "Shared" },
    })
    await expect(secondNext).resolves.toMatchObject({
      value: { type: "text", text: "Shared" },
    })

    source.close()
    await drain(first!)
    await drain(second!)
    await expect(completion).resolves.toEqual({
      status: "completed",
      text: "Shared",
      reasoning: "",
    })

    await expect(drain(subscribeToTextStream(id)!)).resolves.toEqual([
      { type: "text", text: "Shared" },
      { type: "done" },
    ])
    expect(
      db
        .select()
        .from(llmGenerations)
        .where(eq(llmGenerations.llmGenerationId, id))
        .get(),
    ).toMatchObject({
      status: "completed",
      text: "Shared",
      reasoning: "",
      error: null,
    })
  })

  it("persists provider metadata and emits one privacy-safe terminal log", async () => {
    const deepSearchJobId = crypto.randomUUID()
    db.insert(deepSearchJobs)
      .values({
        deepSearchJobId,
        userId: "test-user-id",
        slug: `metadata-${deepSearchJobId}`,
        researchRequest: "Research metadata",
        maxSearches: 1,
        maxResultsPerSearch: 1,
      })
      .run()
    const info = vi.spyOn(console, "info").mockImplementation(() => undefined)
    const source = new AsyncQueue<SourceStreamPart>()
    const { id, completion } = registerTextStream(
      "test-user-id",
      { deepSearchJobId },
      source,
      {
        metadata: {
          modelId: "deepseek-chat",
          promptName: "summarize-search-query",
          finishReason: Promise.resolve("stop"),
          usage: Promise.resolve({
            inputTokens: 120,
            inputTokenDetails: {
              noCacheTokens: 120,
              cacheReadTokens: 0,
              cacheWriteTokens: 0,
            },
            outputTokens: 30,
            outputTokenDetails: {
              textTokens: 20,
              reasoningTokens: 10,
            },
            totalTokens: 150,
          }),
        },
      },
    )

    source.push({ type: "text-delta", id: "text", text: "Result" })
    source.close()
    await expect(completion).resolves.toMatchObject({ status: "completed" })

    expect(
      db
        .select({
          modelId: llmGenerations.modelId,
          promptName: llmGenerations.promptName,
          finishReason: llmGenerations.finishReason,
          inputTokens: llmGenerations.inputTokens,
          outputTokens: llmGenerations.outputTokens,
          reasoningTokens: llmGenerations.reasoningTokens,
        })
        .from(llmGenerations)
        .where(eq(llmGenerations.llmGenerationId, id))
        .get(),
    ).toEqual({
      modelId: "deepseek-chat",
      promptName: "summarize-search-query",
      finishReason: "stop",
      inputTokens: 120,
      outputTokens: 30,
      reasoningTokens: 10,
    })
    expect(info).toHaveBeenCalledOnce()
    expect(info.mock.calls[0]?.[0]).toBe("LLM generation")
    const { durationMs, ...logEntry } = z
      .object({
        generationId: z.string(),
        deepSearchJobId: z.string(),
        stage: z.string(),
        modelId: z.string(),
        status: z.enum(["completed", "failed"]),
        finishReason: z.string().nullable(),
        inputTokens: z.number().nullable(),
        outputTokens: z.number().nullable(),
        reasoningTokens: z.number().nullable(),
        durationMs: z.number().nonnegative(),
      })
      .strict()
      .parse(info.mock.calls[0]?.[1] as unknown)
    expect(durationMs).toBeGreaterThanOrEqual(0)
    expect(logEntry).toEqual({
      generationId: id,
      deepSearchJobId,
      stage: "summarize-search-query",
      modelId: "deepseek-chat",
      status: "completed",
      finishReason: "stop",
      inputTokens: 120,
      outputTokens: 30,
      reasoningTokens: 10,
    })
  })

  it("keeps generation success independent from optional usage metadata", async () => {
    const info = vi.spyOn(console, "info").mockImplementation(() => undefined)
    const source = new AsyncQueue<SourceStreamPart>()
    const { id, completion } = registerTextStream(
      "test-user-id",
      { standalone: true },
      source,
      {
        metadata: {
          modelId: "configured-model",
          promptName: "default",
          finishReason: Promise.resolve("stop"),
          usage: Promise.reject(new Error("Usage unavailable")),
        },
      },
    )

    source.push({ type: "text-delta", id: "text", text: "Result" })
    source.close()
    await expect(completion).resolves.toMatchObject({ status: "completed" })

    expect(
      db
        .select({
          finishReason: llmGenerations.finishReason,
          inputTokens: llmGenerations.inputTokens,
          outputTokens: llmGenerations.outputTokens,
          reasoningTokens: llmGenerations.reasoningTokens,
        })
        .from(llmGenerations)
        .where(eq(llmGenerations.llmGenerationId, id))
        .get(),
    ).toEqual({
      finishReason: "stop",
      inputTokens: null,
      outputTokens: null,
      reasoningTokens: null,
    })
    expect(info).toHaveBeenCalledWith(
      "LLM generation",
      expect.objectContaining({
        generationId: id,
        stage: "default",
        status: "completed",
        finishReason: "stop",
        inputTokens: null,
        outputTokens: null,
        reasoningTokens: null,
      }),
    )
  })

  it("fails closed when finish-reason metadata is unavailable", async () => {
    const source = new AsyncQueue<SourceStreamPart>()
    const { id, completion } = registerTextStream(
      "test-user-id",
      { standalone: true },
      source,
      {
        metadata: {
          modelId: "configured-model",
          promptName: "default",
          finishReason: Promise.reject(new Error("Finish reason unavailable")),
          usage: Promise.reject(new Error("Usage unavailable")),
        },
      },
    )

    source.push({ type: "text-delta", id: "text", text: "Partial result" })
    source.close()
    await expect(completion).resolves.toMatchObject({
      status: "failed",
      failureKind: "finish-reason",
      error: "Text generation did not report a finish reason",
    })

    expect(
      db
        .select({
          status: llmGenerations.status,
          error: llmGenerations.error,
          finishReason: llmGenerations.finishReason,
        })
        .from(llmGenerations)
        .where(eq(llmGenerations.llmGenerationId, id))
        .get(),
    ).toEqual({
      status: "failed",
      error: "Text generation did not report a finish reason",
      finishReason: null,
    })
  })

  it("fails partial text when the provider does not report a normal stop", async () => {
    const source = new AsyncQueue<SourceStreamPart>()
    const { id, completion } = registerTextStream(
      "test-user-id",
      { standalone: true },
      source,
      {
        metadata: {
          modelId: "configured-model",
          promptName: "default",
          finishReason: Promise.resolve("other"),
          usage: Promise.resolve({
            inputTokens: 100,
            inputTokenDetails: {
              noCacheTokens: 100,
              cacheReadTokens: 0,
              cacheWriteTokens: 0,
            },
            outputTokens: 1_024,
            outputTokenDetails: {
              textTokens: 500,
              reasoningTokens: 524,
            },
            totalTokens: 1_124,
          }),
        },
      },
    )

    source.push({ type: "text-delta", id: "text", text: "Partial answer" })
    source.close()

    await expect(completion).resolves.toEqual({
      status: "failed",
      text: "Partial answer",
      reasoning: "",
      error: 'Text generation ended with finish reason "other"',
      finishReason: "other",
      failureKind: "finish-reason",
    })
    await expect(drain(subscribeToTextStream(id)!)).resolves.toEqual([
      { type: "text", text: "Partial answer" },
      {
        type: "error",
        message: 'Text generation ended with finish reason "other"',
      },
      { type: "done" },
    ])
    expect(
      db
        .select({
          status: llmGenerations.status,
          error: llmGenerations.error,
          finishReason: llmGenerations.finishReason,
        })
        .from(llmGenerations)
        .where(eq(llmGenerations.llmGenerationId, id))
        .get(),
    ).toEqual({
      status: "failed",
      error: 'Text generation ended with finish reason "other"',
      finishReason: "other",
    })
  })

  it("classifies an empty other finish as a finish-reason failure", async () => {
    const source = new AsyncQueue<SourceStreamPart>()
    const { id, completion } = registerTextStream(
      "test-user-id",
      { standalone: true },
      source,
      {
        metadata: {
          modelId: "configured-model",
          promptName: "default",
          finishReason: Promise.resolve("other"),
          usage: Promise.reject(new Error("Usage unavailable")),
        },
      },
    )
    source.close()

    await expect(completion).resolves.toEqual({
      status: "failed",
      text: "",
      reasoning: "",
      error: 'Text generation ended with finish reason "other"',
      failureKind: "finish-reason",
      finishReason: "other",
    })
    await expect(drain(subscribeToTextStream(id)!)).resolves.toEqual([
      {
        type: "error",
        message: 'Text generation ended with finish reason "other"',
      },
      { type: "done" },
    ])
  })

  it("evicts a completed live log and replays its durable output", async () => {
    const source = new AsyncQueue<SourceStreamPart>()
    const { id, completion } = registerTextStream(
      "test-user-id",
      { standalone: true },
      source,
    )
    source.push({ type: "text-delta", id: "text", text: "First " })
    source.push({ type: "text-delta", id: "text", text: "second" })
    source.close()
    await expect(completion).resolves.toMatchObject({ status: "completed" })

    await expect(drain(subscribeToTextStream(id)!)).resolves.toEqual([
      { type: "text", text: "First second" },
      { type: "done" },
    ])
  })

  it("buffers failures for current and later readers", async () => {
    const source = new AsyncQueue<SourceStreamPart>()
    const { id, completion } = registerTextStream(
      "test-user-id",
      { standalone: true },
      source,
    )
    source.push({ type: "error", error: new Error("Provider failed") })
    source.close()
    await expect(completion).resolves.toEqual({
      status: "failed",
      text: "",
      reasoning: "",
      error: "Provider failed",
      failureKind: "stream",
    })

    await expect(drain(subscribeToTextStream(id)!)).resolves.toEqual([
      { type: "error", message: "Provider failed" },
      { type: "done" },
    ])
  })

  it("keeps a stream failure distinct from accompanying other metadata", async () => {
    const source = new AsyncQueue<SourceStreamPart>()
    const { completion } = registerTextStream(
      "test-user-id",
      { standalone: true },
      source,
      {
        metadata: {
          modelId: "configured-model",
          promptName: "default",
          finishReason: Promise.resolve("other"),
          usage: Promise.reject(new Error("Usage unavailable")),
        },
      },
    )
    source.push({ type: "error", error: new Error("Provider disconnected") })
    source.close()

    await expect(completion).resolves.toEqual({
      status: "failed",
      text: "",
      reasoning: "",
      error: "Provider disconnected",
      failureKind: "stream",
      finishReason: "other",
    })
  })

  it("runs failed-generation hooks inside the terminal transaction", async () => {
    const source = new AsyncQueue<SourceStreamPart>()
    let failedHookCalled = false
    const { id, completion } = registerTextStream(
      "test-user-id",
      { standalone: true },
      source,
      {
        onFailed: (failed, transaction) => {
          expect(failed).toMatchObject({
            error: "Provider failed",
            text: "Partial answer",
            reasoning: "",
          })
          expect(
            transaction
              .select({ status: llmGenerations.status })
              .from(llmGenerations)
              .where(eq(llmGenerations.llmGenerationId, failed.id))
              .get(),
          ).toEqual({ status: "failed" })
          failedHookCalled = true
        },
      },
    )
    source.push({ type: "text-delta", id: "text", text: "Partial answer" })
    source.push({ type: "error", error: new Error("Provider failed") })
    source.close()

    await expect(completion).resolves.toMatchObject({
      status: "failed",
      error: "Provider failed",
    })
    expect(failedHookCalled).toBe(true)
    expect(
      db
        .select({ status: llmGenerations.status })
        .from(llmGenerations)
        .where(eq(llmGenerations.llmGenerationId, id))
        .get(),
    ).toEqual({ status: "failed" })
  })

  it("fails a provider stream that completes without text", async () => {
    const source = new AsyncQueue<SourceStreamPart>()
    const { id, completion } = registerTextStream(
      "test-user-id",
      { standalone: true },
      source,
    )

    source.close()
    await expect(completion).resolves.toEqual({
      status: "failed",
      text: "",
      reasoning: "",
      error: "Text generation returned no content",
      failureKind: "empty-output",
    })

    await expect(drain(subscribeToTextStream(id)!)).resolves.toEqual([
      { type: "error", message: "Text generation returned no content" },
      { type: "done" },
    ])
    expect(
      db
        .select()
        .from(llmGenerations)
        .where(eq(llmGenerations.llmGenerationId, id))
        .get(),
    ).toMatchObject({
      status: "failed",
      text: "",
      reasoning: "",
      error: "Text generation returned no content",
    })
  })

  it("rolls back a failed completion hook and terminally fails the generation", async () => {
    const source = new AsyncQueue<SourceStreamPart>()
    const { id, completion } = registerTextStream(
      "test-user-id",
      { standalone: true },
      source,
      {
        onCompleted: () => {
          throw new Error("SQLite unavailable")
        },
      },
    )
    const subscribed = subscribeToTextStream(id)

    source.push({ type: "text-delta", id: "text", text: "Result" })
    source.close()

    await expect(completion).rejects.toThrow("SQLite unavailable")
    await expect(drain(subscribed!)).resolves.toEqual([
      { type: "text", text: "Result" },
      { type: "error", message: "SQLite unavailable" },
      { type: "done" },
    ])
    await expect(drain(subscribeToTextStream(id)!)).resolves.toEqual([
      { type: "text", text: "Result" },
      { type: "error", message: "SQLite unavailable" },
      { type: "done" },
    ])
    const generation = db
      .select({
        status: llmGenerations.status,
        error: llmGenerations.error,
        completedAt: llmGenerations.completedAt,
      })
      .from(llmGenerations)
      .where(eq(llmGenerations.llmGenerationId, id))
      .get()
    expect(generation).toMatchObject({
      status: "failed",
      error: "SQLite unavailable",
    })
    expect(generation?.completedAt).toBeInstanceOf(Date)
  })

  it("commits registration hooks before consuming provider output", async () => {
    let consumptionStarted = false
    let registeredId: string | undefined
    const source = {
      async *[Symbol.asyncIterator](): AsyncGenerator<SourceStreamPart> {
        await Promise.resolve()
        consumptionStarted = true
        yield { type: "text-delta", id: "text", text: "Result" }
      },
    }

    const { id, completion } = registerTextStream(
      "test-user-id",
      { standalone: true },
      source,
      {
        onRegistered: (streamId, transaction) => {
          registeredId = streamId
          expect(consumptionStarted).toBe(false)
          expect(
            transaction
              .select({ id: llmGenerations.llmGenerationId })
              .from(llmGenerations)
              .where(eq(llmGenerations.llmGenerationId, streamId))
              .get(),
          ).toEqual({ id: streamId })
        },
      },
    )

    expect(registeredId).toBe(id)
    await expect(completion).resolves.toMatchObject({ status: "completed" })
    expect(consumptionStarted).toBe(true)
  })

  it("does not consume or retain a generation when registration fails", () => {
    let registeredId: string | undefined
    let pulls = 0
    const source = {
      [Symbol.asyncIterator](): AsyncIterator<SourceStreamPart> {
        return {
          next: () => {
            pulls += 1
            return Promise.resolve({ value: undefined, done: true })
          },
        }
      },
    }

    expect(() =>
      registerTextStream("test-user-id", { standalone: true }, source, {
        onRegistered: (streamId) => {
          registeredId = streamId
          throw new Error("Stage registration failed")
        },
      }),
    ).toThrow("Stage registration failed")

    expect(pulls).toBe(0)
    expect(
      db
        .select()
        .from(llmGenerations)
        .where(eq(llmGenerations.llmGenerationId, registeredId!))
        .get(),
    ).toBeUndefined()
  })

  it("returns undefined for unknown streams", () => {
    expect(subscribeToTextStream("missing")).toBeUndefined()
  })

  it("replays terminal output and reasoning from a database-only generation", async () => {
    const llmGenerationId = "database-only-generation"
    db.insert(llmGenerations)
      .values({
        userId: "test-user-id",
        llmGenerationId,
        status: "completed",
        text: "Persisted answer",
        reasoning: "Persisted reasoning",
        completedAt: new Date(),
      })
      .run()

    await expect(drain(subscribeToTextStream(llmGenerationId)!)).resolves.toEqual(
      [
        { type: "reasoning", text: "Persisted reasoning" },
        { type: "text", text: "Persisted answer" },
        { type: "done" },
      ],
    )
  })
})
