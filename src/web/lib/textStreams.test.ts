import { afterEach, describe, expect, it, vi } from "vitest"
import {
  subscribeToTextStream,
  type TextStreamEvent,
} from "./textStreams.ts"

function ndjsonResponse(lines: string[]): Response {
  const encoder = new TextEncoder()
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      for (const line of lines) controller.enqueue(encoder.encode(line))
      controller.close()
    },
  })
  return new Response(stream, {
    status: 200,
    headers: { "Content-Type": "application/x-ndjson" },
  })
}

async function drain(
  stream: AsyncGenerator<TextStreamEvent>,
): Promise<TextStreamEvent[]> {
  const events: TextStreamEvent[] = []
  for await (const event of stream) events.push(event)
  return events
}

describe("text streams client", () => {
  afterEach(() => vi.unstubAllGlobals())

  it("subscribes to a stream using its ID", async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce(
      ndjsonResponse([
        JSON.stringify({ type: "reasoning", text: "Hmm" }) + "\n",
        JSON.stringify({ type: "text", text: "Hi" }) + "\n",
        JSON.stringify({ type: "done" }) + "\n",
      ]),
    )
    vi.stubGlobal("fetch", fetchMock)

    const events = await drain(subscribeToTextStream("stream-id"))

    expect(events.map((event) => event.type)).toEqual([
      "reasoning",
      "text",
      "done",
    ])
    expect(fetchMock).toHaveBeenCalledWith("/api/streams/stream-id", {
      signal: undefined,
    })
  })

  it("throws when subscription fails", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(new Response(null, { status: 500 })),
    )

    await expect(drain(subscribeToTextStream("stream-id"))).rejects.toThrow(
      /500/,
    )
  })

  it("rejects malformed stream events", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        ndjsonResponse([
          JSON.stringify({ type: "text", text: 42 }) + "\n",
        ]),
      ),
    )

    await expect(drain(subscribeToTextStream("stream-id"))).rejects.toThrow()
  })

  it("reassembles events split across read boundaries", async () => {
    const encoder = new TextEncoder()
    const encoded = encoder.encode(
      JSON.stringify({ type: "text", text: "Hello " }) +
        "\n" +
        JSON.stringify({ type: "text", text: "world" }) +
        "\n",
    )
    const half = Math.floor(encoded.length / 2)
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(encoded.slice(0, half))
        controller.enqueue(encoded.slice(half))
        controller.close()
      },
    })
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(new Response(stream, { status: 200 })),
    )

    await expect(drain(subscribeToTextStream("stream-id"))).resolves.toEqual([
      { type: "text", text: "Hello " },
      { type: "text", text: "world" },
    ])
  })
})
