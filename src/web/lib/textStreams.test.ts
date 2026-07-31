import { afterEach, describe, expect, it, vi } from "vitest"
import {
  createTextStream,
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

  it("creates a stream and subscribes using its ID", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(Response.json({ id: "stream-id" }, { status: 201 }))
      .mockResolvedValueOnce(
        ndjsonResponse([
          JSON.stringify({ type: "reasoning", text: "Hmm" }) + "\n",
          JSON.stringify({ type: "text", text: "Hi" }) + "\n",
          JSON.stringify({ type: "done" }) + "\n",
        ]),
      )
    vi.stubGlobal("fetch", fetchMock)

    const id = await createTextStream({ prompt: "Hello" })
    const events = await drain(subscribeToTextStream(id))

    expect(id).toBe("stream-id")
    expect(events.map((event) => event.type)).toEqual([
      "reasoning",
      "text",
      "done",
    ])
    expect(fetchMock).toHaveBeenNthCalledWith(1, "/api/streams", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ prompt: "Hello", promptName: "default" }),
      signal: undefined,
    })
    expect(fetchMock).toHaveBeenNthCalledWith(2, "/api/streams/stream-id", {
      signal: undefined,
    })
  })

  it("throws when stream creation or subscription fails", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(new Response(null, { status: 500 })),
    )

    await expect(createTextStream({ prompt: "Hello" })).rejects.toThrow(/500/)
    await expect(drain(subscribeToTextStream("stream-id"))).rejects.toThrow(
      /500/,
    )
  })

  it("rejects a creation response without an ID", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(Response.json({})))

    await expect(createTextStream({ prompt: "Hello" })).rejects.toThrow(
      /no ID/,
    )
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
