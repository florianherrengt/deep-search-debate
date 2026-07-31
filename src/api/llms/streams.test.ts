import { describe, expect, it } from "vitest"
import type { streamText } from "ai"
import {
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
  it("replays buffered events before following live events", async () => {
    const source = new AsyncQueue<SourceStreamPart>()
    const id = registerTextStream(source)
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
    const id = registerTextStream(source)
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
  })

  it("buffers failures for current and later readers", async () => {
    const source = new AsyncQueue<SourceStreamPart>()
    const id = registerTextStream(source)
    source.push({ type: "error", error: new Error("Provider failed") })
    source.close()
    await Promise.resolve()

    await expect(drain(subscribeToTextStream(id)!)).resolves.toEqual([
      { type: "error", message: "Provider failed" },
      { type: "done" },
    ])
  })

  it("returns undefined for unknown streams", () => {
    expect(subscribeToTextStream("missing")).toBeUndefined()
  })
})
