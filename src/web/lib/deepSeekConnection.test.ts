import { afterEach, describe, expect, it, vi } from "vitest"

import {
  deleteDeepSeekKey,
  getDeepSeekConnection,
  saveDeepSeekKey,
} from "./deepSeekConnection.ts"

describe("DeepSeek connection API", () => {
  afterEach(() => vi.unstubAllGlobals())

  it("reads key presence without requesting the secret", async () => {
    const fetchMock = vi.fn().mockResolvedValue(Response.json({ hasKey: true }))
    vi.stubGlobal("fetch", fetchMock)
    const signal = new AbortController().signal

    await expect(getDeepSeekConnection(signal)).resolves.toEqual({ hasKey: true })
    expect(fetchMock).toHaveBeenCalledWith("/api/deepseek-connection", { signal })
  })

  it("saves and removes a key through the connection endpoint", async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(Response.json({ hasKey: true }))
      .mockResolvedValueOnce(Response.json({ hasKey: false }))
    vi.stubGlobal("fetch", fetchMock)

    await expect(saveDeepSeekKey("secret-key")).resolves.toEqual({ hasKey: true })
    await expect(deleteDeepSeekKey()).resolves.toEqual({ hasKey: false })
    expect(fetchMock).toHaveBeenNthCalledWith(1, "/api/deepseek-connection", {
      body: JSON.stringify({ apiKey: "secret-key" }),
      headers: { "Content-Type": "application/json" },
      method: "PUT",
      signal: undefined,
    })
    expect(fetchMock).toHaveBeenNthCalledWith(2, "/api/deepseek-connection", {
      method: "DELETE",
      signal: undefined,
    })
  })
})
