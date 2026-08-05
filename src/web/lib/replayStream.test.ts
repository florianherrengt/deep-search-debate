import { afterEach, describe, expect, it, vi } from "vitest"
import z from "zod"
import { ApiError, subscribeToNdjson } from "./api.ts"
import { MalformedNdjsonError } from "./ndjson.ts"
import { followReplayableStream } from "./replayStream.ts"

type Event = { type: "value"; value: string } | { type: "done" }

const eventSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("value"), value: z.string() }),
  z.object({ type: z.literal("done") }),
])

function ndjsonResponse(lines: string[]): Response {
  const encoder = new TextEncoder()
  return new Response(
    new ReadableStream<Uint8Array>({
      start(controller) {
        for (const line of lines) controller.enqueue(encoder.encode(line))
        controller.close()
      },
    }),
  )
}

describe("replayable streams", () => {
  afterEach(() => vi.unstubAllGlobals())

  it("reconnects and lets consumers reset before replay after premature EOF", async () => {
    let attempt = 0
    let visibleValues: string[] = []
    const onReplayStart = vi.fn(() => {
      visibleValues = []
    })

    const result = await followReplayableStream<Event>({
      signal: new AbortController().signal,
      subscribe: async function* () {
        await Promise.resolve()
        attempt += 1
        if (attempt === 1) {
          yield { type: "value", value: "partial" }
          return
        }
        yield { type: "value", value: "complete" }
        yield { type: "done" }
      },
      isTerminal: (event) => event.type === "done",
      onOpen: vi.fn(),
      onReplayStart,
      onEvent: (event) => {
        if (event.type === "value") visibleValues.push(event.value)
      },
      onDisconnect: vi.fn(),
      initialRetryDelayMs: 0,
    })

    expect(result).toBe("done")
    expect(onReplayStart).toHaveBeenCalledTimes(2)
    expect(visibleValues).toEqual(["complete"])
  })

  it("does not retry permanent HTTP failures", async () => {
    const onOpen = vi.fn()
    const onDisconnect = vi.fn()

    const result = await followReplayableStream<Event>({
      signal: new AbortController().signal,
      subscribe: async function* () {
        await Promise.resolve()
        const events: Event[] = []
        for (const event of events) yield event
        throw new ApiError("GET", "/api/missing", 404)
      },
      isTerminal: (event) => event.type === "done",
      onOpen,
      onEvent: vi.fn(),
      onDisconnect,
      initialRetryDelayMs: 0,
    })

    expect(result).toBe("failed")
    expect(onOpen).not.toHaveBeenCalled()
    expect(onDisconnect).toHaveBeenCalledWith(expect.any(ApiError), false)
  })

  it("does not retry malformed complete NDJSON frames", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(ndjsonResponse(["{not-json}\n"]))
      .mockResolvedValueOnce(
        ndjsonResponse([JSON.stringify({ type: "done" }) + "\n"]),
      )
    vi.stubGlobal("fetch", fetchMock)
    const onDisconnect = vi.fn()

    const result = await followReplayableStream<Event>({
      signal: new AbortController().signal,
      subscribe: (onOpen) =>
        subscribeToNdjson("/api/events", eventSchema, undefined, onOpen),
      isTerminal: (event) => event.type === "done",
      onOpen: vi.fn(),
      onEvent: vi.fn(),
      onDisconnect,
      initialRetryDelayMs: 0,
    })

    expect(result).toBe("failed")
    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(onDisconnect).toHaveBeenCalledWith(
      expect.any(MalformedNdjsonError),
      false,
    )
  })

  it("retries a truncated trailing NDJSON frame", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(ndjsonResponse(['{"type":"value"']))
      .mockResolvedValueOnce(
        ndjsonResponse([JSON.stringify({ type: "done" }) + "\n"]),
      )
    vi.stubGlobal("fetch", fetchMock)
    const onDisconnect = vi.fn()

    const result = await followReplayableStream<Event>({
      signal: new AbortController().signal,
      subscribe: (onOpen) =>
        subscribeToNdjson("/api/events", eventSchema, undefined, onOpen),
      isTerminal: (event) => event.type === "done",
      onOpen: vi.fn(),
      onEvent: vi.fn(),
      onDisconnect,
      initialRetryDelayMs: 0,
    })

    expect(result).toBe("done")
    expect(fetchMock).toHaveBeenCalledTimes(2)
    expect(onDisconnect).toHaveBeenCalledWith(expect.any(Error), true)
  })

  it("does not deliver an event yielded after cancellation", async () => {
    const controller = new AbortController()
    const release = Promise.withResolvers<void>()
    const onEvent = vi.fn()

    const following = followReplayableStream<Event>({
      signal: controller.signal,
      subscribe: async function* () {
        await release.promise
        yield { type: "value", value: "stale" }
      },
      isTerminal: (event) => event.type === "done",
      onOpen: vi.fn(),
      onEvent,
      onDisconnect: vi.fn(),
      initialRetryDelayMs: 0,
    })

    controller.abort()
    release.resolve()

    await expect(following).resolves.toBe("aborted")
    expect(onEvent).not.toHaveBeenCalled()
  })
})
