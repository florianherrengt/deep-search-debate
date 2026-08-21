import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

const mockFetch = vi.fn()
globalThis.fetch = mockFetch

vi.mock("../config.ts", () => ({
  config: {
    webSearch: {
      maxResponseBytes: 2_000_000,
      serper: {
        apiKey: "test-key",
        maxQueriesPerSecond: 2,
      },
    },
  },
}))

let serper: typeof import("./serper.ts").serper

function searchResponse(
  body: unknown,
  init: { status?: number; statusText?: string } = {},
) {
  return new Response(JSON.stringify(body), {
    status: init.status ?? 200,
    statusText: init.statusText,
    headers: { "Content-Type": "application/json" },
  })
}

describe("serper", () => {
  beforeEach(async () => {
    vi.clearAllMocks()
    vi.resetModules()
    serper = (await import("./serper.ts")).serper
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it("posts the query with the configured API key", async () => {
    mockFetch.mockResolvedValueOnce(searchResponse({ organic: [] }))
    const signal = AbortSignal.timeout(30_000)

    await expect(serper({ query: "evidence query", signal })).resolves.toEqual(
      [],
    )

    expect(mockFetch).toHaveBeenCalledOnce()
    const [url, init] = mockFetch.mock.calls[0] as [string, RequestInit]
    expect(url).toBe("https://google.serper.dev/search")
    expect(init).toMatchObject({
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-API-KEY": "test-key",
      },
      body: JSON.stringify({ q: "evidence query", num: 30 }),
      signal,
    })
  })

  it("maps, normalizes, de-duplicates, and filters organic results", async () => {
    mockFetch.mockResolvedValueOnce(
      searchResponse({
        organic: [
          {
            title: " First result ",
            snippet: " Useful evidence ",
            link: "https://example.com/path?utm_source=test#section",
            position: 1,
          },
          {
            title: "Duplicate",
            snippet: "Duplicate evidence",
            link: "https://example.com/path",
          },
          {
            title: "Missing snippet",
            link: "https://empty.example.com",
          },
          {
            title: "Unsafe",
            snippet: "Ignored",
            link: "javascript:alert(1)",
          },
        ],
        credits: 1,
      }),
    )

    await expect(serper({ query: "test" })).resolves.toEqual([
      {
        title: "First result",
        shortText: "Useful evidence",
        link: "https://example.com/path",
      },
    ])
  })

  it("treats a response without organic results as empty", async () => {
    mockFetch.mockResolvedValueOnce(searchResponse({ searchParameters: {} }))

    await expect(serper({ query: "test" })).resolves.toEqual([])
  })

  it("rejects malformed provider responses", async () => {
    mockFetch.mockResolvedValueOnce(
      searchResponse({
        organic: [
          { title: 123, snippet: "Evidence", link: "https://example.com" },
        ],
      }),
    )

    await expect(serper({ query: "test" })).rejects.toThrow(
      "Serper returned an invalid search response",
    )
  })

  it("preserves non-success statuses as provider errors", async () => {
    mockFetch.mockResolvedValueOnce(
      searchResponse(
        { message: "rate limited" },
        { status: 429, statusText: "Too Many Requests" },
      ),
    )

    await expect(serper({ query: "test" })).rejects.toThrow(
      "Serper search failed with status 429 Too Many Requests",
    )
  })

  it("limits starts to the configured queries per rolling second", async () => {
    vi.useFakeTimers()
    mockFetch.mockImplementation(() =>
      Promise.resolve(searchResponse({ organic: [] })),
    )

    const searches = [
      serper({ query: "one" }),
      serper({ query: "two" }),
      serper({ query: "three" }),
    ]

    await vi.advanceTimersByTimeAsync(0)
    expect(mockFetch).toHaveBeenCalledTimes(2)

    await vi.advanceTimersByTimeAsync(999)
    expect(mockFetch).toHaveBeenCalledTimes(2)

    await vi.advanceTimersByTimeAsync(1)
    expect(mockFetch).toHaveBeenCalledTimes(3)
    await expect(Promise.all(searches)).resolves.toEqual([[], [], []])
  })
})
