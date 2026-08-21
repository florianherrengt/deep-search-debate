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
      timeoutMs: 30_000,
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
    expect(searxng).not.toHaveBeenCalled()
  })
})
