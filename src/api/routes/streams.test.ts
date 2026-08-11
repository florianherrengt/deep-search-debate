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

import { streamReads, streams } from "./streams.ts"
import type { AppEnv } from "../types/auth.ts"
import { db } from "../db/index.ts"
import { config } from "../config.ts"
import { llmGenerations } from "../db/schema/index.ts"

function createApp(): Hono<AppEnv> {
  const app = new Hono<AppEnv>()
  app.use("*", async (c, next) => {
    c.set("userId", "test-user-id")
    c.set("viewerUserId", "test-user-id")
    await next()
  })
  streamReads(app)
  streams(app)
  return app
}

describe("stream routes", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    db.delete(llmGenerations).run()
  })

  const streamId = "11111111-1111-4111-8111-111111111111"

  it("creates a stream and returns its ID", async () => {
    mocks.generateTextStream.mockResolvedValue({
      id: "stream-id",
      completion: Promise.resolve({
        status: "completed",
        text: "Answer",
        reasoning: "",
      }),
    })

    const response = await createApp().request("/streams", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ prompt: "Hello" }),
    })

    expect(response.status).toBe(201)
    expect(response.headers.get("Location")).toBe("/api/streams/stream-id")
    await expect(response.json()).resolves.toEqual({ id: "stream-id" })
    expect(mocks.generateTextStream).toHaveBeenCalledWith({
      userId: "test-user-id",
      owner: { standalone: true },
      prompt: "Hello",
      promptName: "default",
      reasoning: "enabled",
    })
  })

  it("rejects empty and oversized standalone prompts", async () => {
    for (const prompt of [
      "   ",
      "x".repeat(config.deepSearch.maxRequestChars + 1),
    ]) {
      const response = await createApp().request("/streams", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ prompt }),
      })
      expect(response.status).toBe(400)
    }
    expect(mocks.generateTextStream).not.toHaveBeenCalled()
  })

  it("rejects standalone generation above the per-user active limit", async () => {
    db.insert(llmGenerations)
      .values(
        Array.from(
          {
            length:
              config.llmExecution.maxActiveStandaloneGenerationsPerUser,
          },
          (_, position) => ({
            userId: "test-user-id",
            llmGenerationId: crypto.randomUUID(),
            promptName: `standalone-${position}`,
          }),
        ),
      )
      .run()

    const response = await createApp().request("/streams", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ prompt: "One too many" }),
    })

    expect(response.status).toBe(429)
    expect(mocks.generateTextStream).not.toHaveBeenCalled()
  })

  it("replays and follows a text stream as NDJSON", async () => {
    db.insert(llmGenerations)
      .values({ userId: "test-user-id", llmGenerationId: streamId })
      .run()
    async function* events() {
      await Promise.resolve()
      yield { type: "reasoning", text: "Thinking" }
      yield { type: "text", text: "Answer" }
      yield { type: "done" }
    }
    mocks.subscribeToTextStream.mockReturnValue(events())

    const response = await createApp().request(`/streams/${streamId}`)

    expect(response.status).toBe(200)
    expect(response.headers.get("Content-Type")).toContain(
      "application/x-ndjson",
    )
    await expect(response.text()).resolves.toBe(
      '{"type":"reasoning","text":"Thinking"}\n' +
        '{"type":"text","text":"Answer"}\n' +
        '{"type":"done"}\n',
    )
    expect(mocks.subscribeToTextStream).toHaveBeenCalledWith(
      streamId,
      expect.anything(),
    )
  })

  it("returns 404 for an unknown stream", async () => {
    mocks.subscribeToTextStream.mockReturnValue(undefined)

    const response = await createApp().request(`/streams/${streamId}`)

    expect(response.status).toBe(404)
    await expect(response.json()).resolves.toEqual({
      error: "Stream not found",
    })
  })

  it("rejects malformed stream IDs before lookup", async () => {
    const response = await createApp().request("/streams/not-a-uuid")

    expect(response.status).toBe(400)
    expect(mocks.subscribeToTextStream).not.toHaveBeenCalled()
  })
})
