import { Hono } from "hono"
import { beforeEach, describe, expect, it, vi } from "vitest"

import type { AppEnv } from "../types/auth.ts"

const mocks = vi.hoisted(() => ({
  disconnectOpenAiConnection: vi.fn(),
  getOpenAiConnectionSnapshot: vi.fn(),
  startOpenAiConnection: vi.fn(),
}))

vi.mock("../openaiConnection/connectionManager.ts", () => mocks)

import { openAiConnectionRoutes } from "./openAiConnection.ts"

const userId = "openai-route-user"

function createApp() {
  const app = new Hono<AppEnv>().basePath("/api")
  app.use("*", async (c, next) => {
    c.set("userId", userId)
    await next()
  })
  openAiConnectionRoutes(app)
  return app
}

describe("OpenAI connection routes", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.getOpenAiConnectionSnapshot.mockReturnValue({
      status: "disconnected",
    })
    mocks.startOpenAiConnection.mockResolvedValue({
      status: "pending",
      verificationUrl: "https://auth.openai.com/device",
      userCode: "ABCD-EFGH",
      expiresAt: "2026-08-26T12:00:00.000Z",
    })
    mocks.disconnectOpenAiConnection.mockResolvedValue({
      status: "disconnected",
    })
  })

  it("returns the current user's connection state", async () => {
    const response = await createApp().request("/api/openai-connection")

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toEqual({ status: "disconnected" })
    expect(mocks.getOpenAiConnectionSnapshot).toHaveBeenCalledWith(userId)
  })

  it("starts device-code authentication for the current user", async () => {
    const response = await createApp().request(
      "/api/openai-connection/start",
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: "{}",
      },
    )

    expect(response.status).toBe(200)
    expect(mocks.startOpenAiConnection).toHaveBeenCalledWith(userId)
    await expect(response.json()).resolves.toMatchObject({ status: "pending" })
  })

  it("rejects unsupported start options", async () => {
    const response = await createApp().request(
      "/api/openai-connection/start",
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ model: "gpt-5.6-sol" }),
      },
    )

    expect(response.status).toBe(400)
    expect(mocks.startOpenAiConnection).not.toHaveBeenCalled()
  })

  it("disconnects without requiring the encrypted credentials to load", async () => {
    const response = await createApp().request("/api/openai-connection", {
      method: "DELETE",
    })

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toEqual({ status: "disconnected" })
    expect(mocks.disconnectOpenAiConnection).toHaveBeenCalledWith(userId)
  })
})
