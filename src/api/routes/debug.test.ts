import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../web_search/index.ts", () => ({
  webSearch: vi.fn(),
}));

const extractMocks = vi.hoisted(() => ({
  extractPage: vi.fn(),
}));

vi.mock("deep-search-core/search-extract", () => ({
  extractPage: extractMocks.extractPage,
  RedditExtractor: class {},
  AmazonExtractor: class {},
  ShopifyExtractor: class {},
  TrustpilotExtractor: class {},
  GithubExtractor: class {},
  YouTubeExtractor: class {},
  HackerNewsExtractor: class {},
  createScrapingAntPageLoader: vi.fn(() => ({ renderHtml: vi.fn() })),
}));

import { webSearch } from "../web_search/index.ts";
import { extractDeps } from "../web_search/webExtract.ts";
import { app } from "../index.ts";

beforeEach(() => vi.clearAllMocks());

describe("GET /api/debug/search", () => {
  it("returns search results", async () => {
    const mockResults = [
      { title: "Result 1", shortText: "Snippet 1", link: "https://one.com" },
      { title: "Result 2", shortText: "Snippet 2", link: "https://two.com" },
    ];
    vi.mocked(webSearch).mockResolvedValueOnce(mockResults);

    const res = await app.request("/api/debug/search?query=hello");
    expect(res.status).toBe(200);

    const body: unknown = await res.json();
    expect(body).toEqual({ results: mockResults });
    expect(webSearch).toHaveBeenCalledWith({ query: "hello" });
  });

  it("returns 500 when webSearch fails", async () => {
    vi.mocked(webSearch).mockRejectedValueOnce(new Error("search failed"));

    const res = await app.request("/api/debug/search?query=fail");
    expect(res.status).toBe(500);
  });
});

describe("GET /api/debug/extract", () => {
  it("returns the full extraction result with diagnostics", async () => {
    extractMocks.extractPage.mockResolvedValueOnce({
      url: "https://example.com",
      content: "Hello World",
      method: "custom",
      usedCustomExtractor: true,
      extractorName: "reddit",
      warnings: ["falling back"],
      html: "<html>long</html>",
    });

    const res = await app.request(
      "/api/debug/extract?url=https%3A%2F%2Fexample.com",
    );
    expect(res.status).toBe(200);

    const body = (await res.json()) as Record<string, unknown>;
    expect(body).toMatchObject({
      url: "https://example.com",
      content: "Hello World",
      contentLength: 11,
      method: "custom",
      usedCustomExtractor: true,
      extractorName: "reddit",
      warnings: ["falling back"],
      htmlLength: 17,
    });
    expect(extractMocks.extractPage).toHaveBeenCalledWith(
      "https://example.com",
      undefined,
      extractDeps,
    );
  });

  it("returns 500 with the error message when extraction fails", async () => {
    extractMocks.extractPage.mockRejectedValueOnce(new Error("fetch failed"));

    const res = await app.request(
      "/api/debug/extract?url=https%3A%2F%2Fexample.com",
    );
    expect(res.status).toBe(500);
    const body = (await res.json()) as Record<string, unknown>;
    expect(body).toMatchObject({ error: "fetch failed" });
  });

  it("rejects non-URL inputs", async () => {
    const res = await app.request("/api/debug/extract?url=not-a-url");
    expect(res.status).toBe(400);
    expect(extractMocks.extractPage).not.toHaveBeenCalled();
  });
});
