import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Hono } from "hono"

vi.mock("../web_search/index.ts", () => ({
  webSearch: vi.fn(),
}));

const extractMocks = vi.hoisted(() => ({
  extractPage: vi.fn(),
}));

vi.mock("deep-search-core/search-extract", () => ({
  extractPage: extractMocks.extractPage,
  PdfExtractor: class {},
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
import { debug } from "./debug.ts"
import type { AppEnv } from "../types/auth.ts"

function createApp(isDebugUser: boolean): Hono<AppEnv> {
  const app = new Hono<AppEnv>().basePath("/api")
  app.use("*", async (c, next) => {
    c.set("isDebugUser", isDebugUser)
    c.set("userId", "test-user-id")
    await next()
  })
  debug(app)
  return app
}

const app = createApp(true)
const regularUserApp = createApp(false)

beforeEach(() => {
  vi.clearAllMocks()
  vi.spyOn(console, "error").mockImplementation(() => {})
});

afterEach(() => vi.restoreAllMocks())

it("hides debug routes from ordinary authenticated users", async () => {
  const response = await regularUserApp.request("/api/debug/search?query=hello")

  expect(response.status).toBe(404)
  expect(webSearch).not.toHaveBeenCalled()
})

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
    await expect(res.json()).resolves.toEqual({ error: "Search failed" })
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

  it("returns a sanitized 500 when extraction fails", async () => {
    extractMocks.extractPage.mockRejectedValueOnce(new Error("fetch failed"));

    const res = await app.request(
      "/api/debug/extract?url=https%3A%2F%2Fexample.com",
    );
    expect(res.status).toBe(500);
    await expect(res.json()).resolves.toEqual({ error: "Extraction failed" })
  });

  it("rejects non-URL inputs", async () => {
    const res = await app.request("/api/debug/extract?url=not-a-url");
    expect(res.status).toBe(400);
    expect(extractMocks.extractPage).not.toHaveBeenCalled();
  });
});
