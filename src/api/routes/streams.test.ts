import { Hono } from "hono"
import { beforeEach, describe, expect, it, vi } from "vitest"

const mocks = vi.hoisted(() => ({
  generateTextStream: vi.fn(),
  subscribeToTextStream: vi.fn(),
}))

vi.mock("../llms/generateText.ts", () => ({
  generateTextStream: mocks.generateTextStream,
}))

vi.mock("../llms/streams.ts", () => ({
  subscribeToTextStream: mocks.subscribeToTextStream,
}))

import { streams } from "./streams.ts"

function createApp(): Hono {
  const app = new Hono()
  streams(app)
  return app
}

describe("stream routes", () => {
  beforeEach(() => vi.clearAllMocks())

  it("creates a stream and returns its ID", async () => {
    mocks.generateTextStream.mockResolvedValue({ id: "stream-id" })

    const response = await createApp().request("/streams", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ prompt: "Hello" }),
    })

    expect(response.status).toBe(201)
    expect(response.headers.get("Location")).toBe("/api/streams/stream-id")
    await expect(response.json()).resolves.toEqual({ id: "stream-id" })
    expect(mocks.generateTextStream).toHaveBeenCalledWith({
      prompt: "Hello",
      promptName: "default",
    })
  })

  it("replays and follows a text stream as NDJSON", async () => {
    async function* events() {
      await Promise.resolve()
      yield { type: "reasoning", text: "Thinking" }
      yield { type: "text", text: "Answer" }
      yield { type: "done" }
    }
    mocks.subscribeToTextStream.mockReturnValue(events())

    const response = await createApp().request("/streams/stream-id")

    expect(response.status).toBe(200)
    expect(response.headers.get("Content-Type")).toContain(
      "application/x-ndjson",
    )
    await expect(response.text()).resolves.toBe(
      '{"type":"reasoning","text":"Thinking"}\n' +
        '{"type":"text","text":"Answer"}\n' +
        '{"type":"done"}\n',
    )
  })

  it("returns 404 for an unknown stream", async () => {
    mocks.subscribeToTextStream.mockReturnValue(undefined)

    const response = await createApp().request("/streams/missing")

    expect(response.status).toBe(404)
    await expect(response.json()).resolves.toEqual({
      error: "Stream not found",
    })
  })
})
