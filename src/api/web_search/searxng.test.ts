import { describe, expect, it, vi, beforeEach } from "vitest";

const mockFetch = vi.fn();
globalThis.fetch = mockFetch;

import { searxng } from "./searxng.ts";

const mockJsonResponse = (overrides: Record<string, unknown> = {}) => ({
  query: "test",
  results: [],
  ...overrides,
});

describe("searxng", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("searches and returns mapped results", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      status: 200,
      text: () =>
        Promise.resolve(JSON.stringify(
          mockJsonResponse({
            results: [
              { title: "Test Title", content: "Test snippet", url: "https://example.com" },
              { title: "Second Result", content: "Another snippet", url: "https://example.org" },
            ],
          }),
        )),
    });

    const results = await searxng({ query: "test" });

    expect(results).toEqual([
      { title: "Test Title", shortText: "Test snippet", link: "https://example.com" },
      { title: "Second Result", shortText: "Another snippet", link: "https://example.org" },
    ]);

    const url = new URL(mockFetch.mock.calls[0][0] as string);
    expect(url.searchParams.get("q")).toBe("test");
    expect(url.searchParams.get("format")).toBe("json");
  });

  it("uses the configured base URL", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      status: 200,
      text: () => Promise.resolve(JSON.stringify(mockJsonResponse())),
    });

    await searxng({ query: "test" });

    const fetchedUrl = mockFetch.mock.calls[0][0] as string;
    expect(fetchedUrl).toMatch(/^http:\/\/localhost:8090\//);
  });

  it("throws on non-ok response", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: false,
      status: 500,
      statusText: "Internal Server Error",
      text: () => Promise.resolve("failure"),
    });

    await expect(searxng({ query: "test" })).rejects.toThrow(
      "SearXNG",
    );
  });

  it("throws when results array is missing", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      status: 200,
      text: () => Promise.resolve(JSON.stringify({ query: "test" })),
    });

    await expect(searxng({ query: "test" })).rejects.toThrow();
  });

  it("throws when result items are malformed", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      status: 200,
      text: () =>
        Promise.resolve(JSON.stringify({
          query: "test",
          results: [{ title: 123, content: "ok", url: "https://x.com" }],
        })),
    });

    await expect(searxng({ query: "test" })).rejects.toThrow();
  });

  it("rejects empty search facts and invalid result URLs", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      status: 200,
      text: () =>
        Promise.resolve(JSON.stringify({
          query: "test",
          results: [
            { title: "   ", content: "", url: "not-a-url" },
          ],
        })),
    });

    await expect(searxng({ query: "test" })).rejects.toThrow();
  });
});
