import { describe, expect, it, vi } from "vitest"

vi.mock("./searxng.ts", () => ({
  searxng: vi.fn(),
}))
vi.mock("./serper.ts", () => ({
  serper: vi.fn(),
}))
vi.mock("../config.ts", () => ({
  config: {
    auth: { adminEmail: undefined },
    webSearch: {
      provider: "serper",
      timeoutMs: 120_000,
      creditsPerRequest: 1,
    },
  },
}))

import { serper } from "./serper.ts"
import { searxng } from "./searxng.ts"
import { webSearch } from "./index.ts"

describe("webSearch", () => {
  it("delegates to the production Serper provider", async () => {
    const mockResults = [
      { title: "A", shortText: "B", link: "https://a.com" },
      { title: "C", shortText: "D", link: "https://c.com" },
    ]
    vi.mocked(serper).mockResolvedValueOnce(mockResults)

    const results = await webSearch({ userId: "test-user-id", query: "hello" })

    expect(results).toEqual({ results: mockResults, creditsUsed: 1 })
    expect(serper).toHaveBeenCalledOnce()
    const providerInput = vi.mocked(serper).mock.calls[0]?.[0]
    expect(providerInput?.query).toBe("hello")
    expect(providerInput?.signal).toBeInstanceOf(AbortSignal)
    expect(providerInput?.deadlineSignal).toBeInstanceOf(AbortSignal)
    expect(searxng).not.toHaveBeenCalled()
  })

  it("rejects caller cancellation that arrives after deadline fallback starts settling", async () => {
    const caller = new AbortController()
    const deadline = new AbortController()
    const providerStarted = Promise.withResolvers<void>()
    const finishProvider = Promise.withResolvers<void>()
    const timeout = vi.spyOn(AbortSignal, "timeout").mockReturnValue(deadline.signal)
    vi.mocked(serper).mockImplementationOnce(async () => {
      providerStarted.resolve()
      await finishProvider.promise
      return [{ title: "Top result", shortText: "Resolved top result", link: "https://example.com" }]
    })

    try {
      const pending = webSearch({ userId: "test-user-id", query: "hello", signal: caller.signal })
      await providerStarted.promise
      deadline.abort(new Error("Search deadline exceeded"))
      caller.abort(new Error("User stopped search"))
      finishProvider.resolve()

      await expect(pending).rejects.toThrow("User stopped search")
    } finally {
      timeout.mockRestore()
    }
  })

})
