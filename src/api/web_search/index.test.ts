import { describe, expect, it, vi } from "vitest"

vi.mock("./searxng.ts", () => ({
  searxng: vi.fn(),
}))
vi.mock("./brave.ts", () => ({
  brave: vi.fn(),
}))
vi.mock("../config.ts", () => ({
  config: {
    webSearch: {
      provider: "brave",
      timeoutMs: 30_000,
      creditsPerRequest: 1,
    },
  },
}))

import { brave } from "./brave.ts"
import { searxng } from "./searxng.ts"
import { webSearch } from "./index.ts"

describe("webSearch", () => {
  it("delegates to the production Brave provider", async () => {
    const mockResults = [
      { title: "A", shortText: "B", link: "https://a.com" },
      { title: "C", shortText: "D", link: "https://c.com" },
    ]
    vi.mocked(brave).mockResolvedValueOnce(mockResults)

    const results = await webSearch({ userId: "test-user-id", query: "hello" })

    expect(results).toEqual({ results: mockResults, creditsUsed: 1 })
    expect(brave).toHaveBeenCalledOnce()
    const providerInput = vi.mocked(brave).mock.calls[0]?.[0]
    expect(providerInput?.query).toBe("hello")
    expect(providerInput?.signal).toBeInstanceOf(AbortSignal)
    expect(searxng).not.toHaveBeenCalled()
  })
})
