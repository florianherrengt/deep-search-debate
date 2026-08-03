import { beforeEach, describe, expect, it, vi } from "vitest"

const mocks = vi.hoisted(() => ({
  extractPage: vi.fn(),
  renderHtml: vi.fn(),
}))

vi.mock("deep-search-core/search-extract", () => ({
  extractPage: mocks.extractPage,
  PdfExtractor: class {},
  RedditExtractor: class {},
  AmazonExtractor: class {},
  ShopifyExtractor: class {},
  TrustpilotExtractor: class {},
  GithubExtractor: class {},
  YouTubeExtractor: class {},
  HackerNewsExtractor: class {},
  createScrapingAntPageLoader: vi.fn(() => ({ renderHtml: mocks.renderHtml })),
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

  it("serializes ScrapingAnt renders", async () => {
    const completeRenders: Array<() => void> = []
    mocks.renderHtml.mockImplementation(
      () =>
        new Promise<string>((resolve) => {
          completeRenders.push(() => resolve("<html>rendered</html>"))
        }),
    )

    const renderHtml = extractDeps.pageLoader?.renderHtml
    expect(renderHtml).toBeDefined()

    const first = renderHtml?.("https://example.com/one", {})
    const second = renderHtml?.("https://example.com/two", {})

    await vi.waitFor(() => expect(mocks.renderHtml).toHaveBeenCalledTimes(1))
    completeRenders[0]?.()
    await first

    await vi.waitFor(() => expect(mocks.renderHtml).toHaveBeenCalledTimes(2))
    completeRenders[1]?.()
    await second
  })

  it("retries a render rejected by ScrapingAnt anti-bot detection", async () => {
    mocks.renderHtml
      .mockRejectedValueOnce(
        new Error("ScrapingAnt request failed with HTTP 423"),
      )
      .mockResolvedValueOnce("<html>rendered</html>")

    const renderHtml = extractDeps.pageLoader?.renderHtml
    await expect(
      renderHtml?.("https://example.com/protected", {}),
    ).resolves.toBe("<html>rendered</html>")
    expect(mocks.renderHtml).toHaveBeenCalledTimes(2)
  })

  it("stops retrying anti-bot detections at the configured limit", async () => {
    mocks.renderHtml.mockRejectedValue(
      new Error("ScrapingAnt request failed with HTTP 423"),
    )

    const renderHtml = extractDeps.pageLoader?.renderHtml
    await expect(
      renderHtml?.("https://example.com/protected", {}),
    ).rejects.toThrow("ScrapingAnt request failed with HTTP 423")
    expect(mocks.renderHtml).toHaveBeenCalledTimes(3)
  })
})
