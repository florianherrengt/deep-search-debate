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

    const signal = AbortSignal.timeout(30_000);
    const results = await searxng({ query: "test", signal });

    expect(results).toEqual([
      { title: "Test Title", shortText: "Test snippet", link: "https://example.com/" },
      { title: "Second Result", shortText: "Another snippet", link: "https://example.org/" },
    ]);

    const url = new URL(mockFetch.mock.calls[0][0] as string);
    expect(url.searchParams.get("q")).toBe("test");
    expect(url.searchParams.get("format")).toBe("json");
    expect(url.searchParams.get("categories")).toBe("general,science");
    expect((mockFetch.mock.calls[0][1] as RequestInit).signal).toBe(signal);
  });

  it("drops provider results that have no usable search snippet", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      status: 200,
      text: () =>
        Promise.resolve(JSON.stringify(
          mockJsonResponse({
            results: [
              { title: "No snippet", content: "   ", url: "https://empty.example.com" },
              { title: "Useful result", content: "Useful evidence", url: "https://useful.example.com" },
            ],
          }),
        )),
    });

    await expect(searxng({ query: "test" })).resolves.toEqual([
      {
        title: "Useful result",
        shortText: "Useful evidence",
        link: "https://useful.example.com/",
      },
    ]);
  });

  it("normalizes, de-duplicates, and filters unsupported result URLs", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      status: 200,
      text: () =>
        Promise.resolve(JSON.stringify(
          mockJsonResponse({
            results: [
              {
                title: "First",
                content: "Useful evidence",
                url: "https://example.com/path?utm_source=test#section",
              },
              {
                title: "Duplicate",
                content: "Duplicate evidence",
                url: "https://example.com/path",
              },
              {
                title: "Unsafe",
                content: "Should be ignored",
                url: "javascript:alert(1)",
              },
            ],
          }),
        )),
    });

    await expect(searxng({ query: "test" })).resolves.toEqual([
      {
        title: "First",
        shortText: "Useful evidence",
        link: "https://example.com/path",
      },
    ]);
  });

  it("uses the configured base URL", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      status: 200,
      text: () => Promise.resolve(JSON.stringify(mockJsonResponse())),
    });

    await searxng({ query: "test" });

    const fetchedUrl = String(mockFetch.mock.calls[0][0]);
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

  it("drops empty search facts and invalid result URLs", async () => {
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

    await expect(searxng({ query: "test" })).resolves.toEqual([]);
  });
});
