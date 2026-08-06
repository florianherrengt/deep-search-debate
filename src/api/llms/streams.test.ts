import { describe, expect, it } from "vitest"
import { eq } from "drizzle-orm"
import type { streamText } from "ai"
import { db } from "../db/index.ts"
import { llmGenerations } from "../db/schema/index.ts"
import {
  registerTextStream,
  subscribeToTextStream,
  type TextStreamEvent,
  waitForTextStream,
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
  it("replays buffered events before following live events", async () => {
    const source = new AsyncQueue<SourceStreamPart>()
    const id = registerTextStream("test-user-id", { standalone: true }, source)
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
  })

  it("supports concurrent readers and repeated completed reads", async () => {
    const source = new AsyncQueue<SourceStreamPart>()
    const id = registerTextStream("test-user-id", { standalone: true }, source)
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

  it("evicts a completed live log and replays its durable output", async () => {
    const source = new AsyncQueue<SourceStreamPart>()
    const id = registerTextStream("test-user-id", { standalone: true }, source)
    source.push({ type: "text-delta", id: "text", text: "First " })
    source.push({ type: "text-delta", id: "text", text: "second" })
    source.close()
    await waitForTextStream(id)

    await expect(drain(subscribeToTextStream(id)!)).resolves.toEqual([
      { type: "text", text: "First second" },
      { type: "done" },
    ])
  })

  it("buffers failures for current and later readers", async () => {
    const source = new AsyncQueue<SourceStreamPart>()
    const id = registerTextStream("test-user-id", { standalone: true }, source)
    source.push({ type: "error", error: new Error("Provider failed") })
    source.close()
    await Promise.resolve()

    await expect(drain(subscribeToTextStream(id)!)).resolves.toEqual([
      { type: "error", message: "Provider failed" },
      { type: "done" },
    ])
  })

  it("fails a provider stream that completes without text", async () => {
    const source = new AsyncQueue<SourceStreamPart>()
    const id = registerTextStream("test-user-id", { standalone: true }, source)

    source.close()
    await waitForTextStream(id)

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
    const id = registerTextStream("test-user-id", { standalone: true }, source, {
      onCompleted: () => {
        throw new Error("SQLite unavailable")
      },
    })
    const subscribed = subscribeToTextStream(id)
    const completion = waitForTextStream(id)

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
