import { Hono } from "hono"
import { beforeEach, describe, expect, it, vi } from "vitest"

import type { AppEnv } from "../types/auth.ts"

const mocks = vi.hoisted(() => ({
  deleteDeepSeekApiKey: vi.fn(),
  hasDeepSeekApiKey: vi.fn(),
  setDeepSeekApiKey: vi.fn(),
}))

vi.mock("../deepseekConnection/keysRepository.ts", () => mocks)

import { deepSeekConnectionRoutes } from "./deepSeekConnection.ts"

const userId = "deepseek-route-user"

function createApp() {
  const app = new Hono<AppEnv>().basePath("/api")
  app.use("*", async (c, next) => {
    c.set("userId", userId)
    await next()
  })
  deepSeekConnectionRoutes(app)
  return app
}

describe("DeepSeek connection routes", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.hasDeepSeekApiKey.mockReturnValue(false)
    mocks.deleteDeepSeekApiKey.mockReturnValue(false)
  })

  it("reports whether the current user has a key without exposing it", async () => {
    mocks.hasDeepSeekApiKey.mockReturnValue(true)
    const response = await createApp().request("/api/deepseek-connection")

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toEqual({ hasKey: true })
    expect(mocks.hasDeepSeekApiKey).toHaveBeenCalledWith(userId)
  })

  it("stores a nonempty key for the current user without validating it upstream", async () => {
    const response = await createApp().request("/api/deepseek-connection", {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ apiKey: "user-provided-key" }),
    })

    expect(response.status).toBe(200)
    expect(mocks.setDeepSeekApiKey).toHaveBeenCalledWith(
      userId,
      "user-provided-key",
    )
    await expect(response.json()).resolves.toEqual({ hasKey: true })
  })

  it.each([
    "",
    "   ",
    JSON.stringify({ apiKey: "key", extra: true }),
  ])("rejects invalid key input %j", async (input) => {
    const body = input.startsWith("{") ? input : JSON.stringify({ apiKey: input })
    const response = await createApp().request("/api/deepseek-connection", {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body,
    })

    expect(response.status).toBe(400)
    expect(mocks.setDeepSeekApiKey).not.toHaveBeenCalled()
  })

  it("deletes only the current user's key and reports the disconnected state", async () => {
    const response = await createApp().request("/api/deepseek-connection", {
      method: "DELETE",
    })

    expect(response.status).toBe(200)
    expect(mocks.deleteDeepSeekApiKey).toHaveBeenCalledWith(userId)
    await expect(response.json()).resolves.toEqual({ hasKey: false })
  })
})
