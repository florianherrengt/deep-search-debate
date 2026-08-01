import { beforeEach, describe, expect, it, vi } from "vitest"

const mocks = vi.hoisted(() => ({
  extractPage: vi.fn(),
}))

vi.mock("deep-search-core/search-extract", () => ({
  extractPage: mocks.extractPage,
  RedditExtractor: class {},
  AmazonExtractor: class {},
  ShopifyExtractor: class {},
  TrustpilotExtractor: class {},
  GithubExtractor: class {},
  YouTubeExtractor: class {},
  HackerNewsExtractor: class {},
  createScrapingAntPageLoader: vi.fn(() => ({ renderHtml: vi.fn() })),
}))

import { webExtract, extractDeps } from "./webExtract.ts"

describe("webExtract", () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it("delegates to extractPage and returns url + content", async () => {
    mocks.extractPage.mockResolvedValueOnce({
      url: "https://example.com",
      content: "Hello World",
      html: "<html><body>Hello World</body></html>",
      usedCustomExtractor: false,
      method: "fetch",
      warnings: [],
    })

    const result = await webExtract({ url: "https://example.com" })

    expect(mocks.extractPage).toHaveBeenCalledWith(
      "https://example.com",
      undefined,
      extractDeps,
    )
    expect(result).toEqual({ url: "https://example.com", content: "Hello World" })
  })

  it("propagates errors from extractPage", async () => {
    mocks.extractPage.mockRejectedValueOnce(new Error("fetch failed"))

    await expect(webExtract({ url: "https://example.com" })).rejects.toThrow("fetch failed")
  })

  it("rejects invalid URLs via zod validation", async () => {
    await expect(webExtract({ url: "not-a-url" })).rejects.toThrow()
  })
})
