import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

const mockFetch = vi.fn()
globalThis.fetch = mockFetch

vi.mock("../config.ts", () => ({
  config: {
    webSearch: {
      maxResponseBytes: 2_000_000,
      timeoutMs: 120_000,
      serper: {
        apiKey: "test-key",
        maxQueriesPerSecond: 2,
      },
    },
  },
}))

vi.mock("node:timers/promises", () => ({
  setTimeout: (milliseconds: number, _value: unknown, options?: { signal?: AbortSignal }) =>
    new Promise<void>((resolve, reject) => {
      const timeout = globalThis.setTimeout(resolve, milliseconds)
      options?.signal?.addEventListener("abort", () => {
        globalThis.clearTimeout(timeout)
        const signal = options.signal
        if (signal) reject(abortReason(signal))
      }, { once: true })
    }),
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

function abortReason(signal: AbortSignal): Error {
  const reason: unknown = signal.reason
  return reason instanceof Error ? reason : new Error(String(reason))
}

async function expectFetchCalls(count: number) {
  for (let attempt = 0; attempt < 20 && mockFetch.mock.calls.length < count; attempt += 1) {
    await Promise.resolve()
  }
  for (let attempt = 0; attempt < 5; attempt += 1) await Promise.resolve()
  expect(mockFetch).toHaveBeenCalledTimes(count)
}

describe("serper", () => {
  beforeEach(async () => {
    vi.clearAllMocks()
    mockFetch.mockReset()
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

  it("resolves the complete search response and returns only resolved organic links", async () => {
    const searchBody = {
      searchParameters: { q: "evidence query", type: "search" },
      organic: [
        { title: "First", snippet: "First evidence", link: "https://first.example.com" },
        { title: "Second", snippet: "Second evidence", link: "https://second.example.com" },
        { title: "Third", snippet: "Third evidence", link: "https://third.example.com" },
        { title: "Fourth", snippet: "Fourth evidence", link: "https://www.google.com/goto?url=opaque" },
      ],
      knowledgeGraph: { website: "https://www.google.com/goto?url=other-opaque" },
      credits: 1,
    }
    const resolvedBody = {
      ...searchBody,
      organic: searchBody.organic.map((result, index) => ({
        ...result,
        link: index === 3 ? "https://fourth.example.com" : result.link,
      })),
      knowledgeGraph: { website: "https://other.example.com" },
    }
    mockFetch
      .mockResolvedValueOnce(searchResponse(searchBody))
      .mockResolvedValueOnce(searchResponse(resolvedBody))

    await expect(serper({ query: "evidence query" })).resolves.toEqual([
      { title: "First", shortText: "First evidence", link: "https://first.example.com/" },
      { title: "Second", shortText: "Second evidence", link: "https://second.example.com/" },
      { title: "Third", shortText: "Third evidence", link: "https://third.example.com/" },
      { title: "Fourth", shortText: "Fourth evidence", link: "https://fourth.example.com/" },
    ])

    expect(mockFetch).toHaveBeenCalledTimes(2)
    const [resolveUrl, resolveInit] = mockFetch.mock.calls[1] as [string, RequestInit]
    expect(resolveUrl).toBe("https://google.serper.dev/resolve")
    expect(resolveInit).toMatchObject({
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-API-KEY": "test-key",
      },
      body: JSON.stringify(searchBody),
    })
  })

  it("reposts the complete partial resolver response after retryAfter", async () => {
    vi.useFakeTimers()
    const searchBody = {
      searchParameters: { q: "evidence query" },
      organic: [
        { title: "First", snippet: "First evidence", link: "https://first.example.com" },
        { title: "Fourth", snippet: "Fourth evidence", link: "https://www.google.com/goto?url=opaque" },
      ],
    }
    const partialBody = {
      ...searchBody,
      organic: [
        searchBody.organic[0],
        { ...searchBody.organic[1], link: "https://www.google.com/goto?url=still-opaque" },
      ],
      retryAfter: 1,
    }
    const resolvedBody = {
      ...partialBody,
      organic: [searchBody.organic[0], { ...searchBody.organic[1], link: "https://fourth.example.com" }],
      retryAfter: undefined,
    }
    mockFetch
      .mockResolvedValueOnce(searchResponse(searchBody))
      .mockResolvedValueOnce(searchResponse(partialBody))
      .mockResolvedValueOnce(searchResponse(resolvedBody))

    try {
      const pending = serper({ query: "evidence query" })
      await expectFetchCalls(2)
      expect(mockFetch).toHaveBeenCalledTimes(2)
      await vi.advanceTimersByTimeAsync(999)
      expect(mockFetch).toHaveBeenCalledTimes(2)
      await vi.advanceTimersByTimeAsync(1_000 - 999)
      await expectFetchCalls(3)
      const [, retryInit] = mockFetch.mock.calls[2] as [string, RequestInit]
      expect(retryInit.body).toBe(JSON.stringify(partialBody))
      await expect(pending).resolves.toEqual([
        { title: "First", shortText: "First evidence", link: "https://first.example.com/" },
        { title: "Fourth", shortText: "Fourth evidence", link: "https://fourth.example.com/" },
      ])
    } finally {
      vi.useRealTimers()
    }
  })

  it("returns resolved links when the resolver stays partial without retryAfter", async () => {
    const searchBody = {
      organic: [
        { title: "First", snippet: "First evidence", link: "https://first.example.com" },
        { title: "Fourth", snippet: "Fourth evidence", link: "https://www.google.com/goto?url=opaque" },
      ],
    }
    mockFetch
      .mockResolvedValueOnce(searchResponse(searchBody))
      .mockResolvedValueOnce(searchResponse({
        organic: [searchBody.organic[0], searchBody.organic[1]],
      }))

    await expect(serper({ query: "evidence query" })).resolves.toEqual([
      { title: "First", shortText: "First evidence", link: "https://first.example.com/" },
    ])
    expect(mockFetch).toHaveBeenCalledTimes(2)
  })

  it("falls back to the original top three when resolution fails", async () => {
    const searchBody = {
      organic: [
        { title: "First", snippet: "First evidence", link: "https://first.example.com" },
        { title: "Second", snippet: "Second evidence", link: "https://second.example.com" },
        { title: "Third", snippet: "Third evidence", link: "https://third.example.com" },
        { title: "Fourth", snippet: "Fourth evidence", link: "https://www.google.com/goto?url=opaque" },
      ],
    }
    mockFetch
      .mockResolvedValueOnce(searchResponse(searchBody))
      .mockResolvedValueOnce(searchResponse({ message: "resolver unavailable" }, { status: 503, statusText: "Service Unavailable" }))

    await expect(serper({ query: "evidence query" })).resolves.toEqual([
      { title: "First", shortText: "First evidence", link: "https://first.example.com/" },
      { title: "Second", shortText: "Second evidence", link: "https://second.example.com/" },
      { title: "Third", shortText: "Third evidence", link: "https://third.example.com/" },
    ])
  })

  it("falls back to the original top three when the resolver body is malformed", async () => {
    const searchBody = {
      organic: [
        { title: "First", snippet: "First evidence", link: "https://first.example.com" },
        { title: "Second", snippet: "Second evidence", link: "https://second.example.com" },
        { title: "Third", snippet: "Third evidence", link: "https://third.example.com" },
        { title: "Fourth", snippet: "Fourth evidence", link: "https://www.google.com/goto?url=opaque" },
      ],
    }
    mockFetch
      .mockResolvedValueOnce(searchResponse(searchBody))
      .mockResolvedValueOnce(new Response("not JSON", { status: 200 }))

    await expect(serper({ query: "evidence query" })).resolves.toEqual([
      { title: "First", shortText: "First evidence", link: "https://first.example.com/" },
      { title: "Second", shortText: "Second evidence", link: "https://second.example.com/" },
      { title: "Third", shortText: "Third evidence", link: "https://third.example.com/" },
    ])
  })

  it("retains the latest valid resolved links when a later resolve attempt fails", async () => {
    vi.useFakeTimers()
    try {
      const searchBody = {
        organic: [
          { title: "First", snippet: "First evidence", link: "https://first.example.com" },
          { title: "Fourth", snippet: "Fourth evidence", link: "https://www.google.com/goto?url=fourth-opaque" },
          { title: "Fifth", snippet: "Fifth evidence", link: "https://www.google.com/goto?url=fifth-opaque" },
        ],
      }
      const partialBody = {
        ...searchBody,
        organic: [
          searchBody.organic[0],
          { ...searchBody.organic[1], link: "https://fourth.example.com" },
          { ...searchBody.organic[2], link: "https://www.google.com/goto?url=still-opaque" },
        ],
        retryAfter: 1,
      }
      mockFetch
        .mockResolvedValueOnce(searchResponse(searchBody))
        .mockResolvedValueOnce(searchResponse(partialBody))
        .mockResolvedValueOnce(searchResponse({ message: "resolver unavailable" }, { status: 503, statusText: "Service Unavailable" }))

      const pending = serper({ query: "evidence query" })
      await expectFetchCalls(2)
      await vi.advanceTimersByTimeAsync(1_000)
      await expectFetchCalls(3)

      await expect(pending).resolves.toEqual([
        { title: "First", shortText: "First evidence", link: "https://first.example.com/" },
        { title: "Fourth", shortText: "Fourth evidence", link: "https://fourth.example.com/" },
      ])
    } finally {
      vi.useRealTimers()
    }
  })

  it("rejects caller cancellation during resolution instead of returning fallback links", async () => {
    const searchBody = {
      organic: [
        { title: "First", snippet: "First evidence", link: "https://first.example.com" },
        { title: "Fourth", snippet: "Fourth evidence", link: "https://www.google.com/goto?url=opaque" },
      ],
    }
    let resolverSignal: AbortSignal | undefined
    mockFetch.mockResolvedValueOnce(searchResponse(searchBody)).mockImplementationOnce((_input: RequestInfo | URL, init?: RequestInit) => {
      const signal = init?.signal
      resolverSignal = signal ?? undefined
      return new Promise<Response>((_resolve, reject) => {
        if (signal) signal.addEventListener("abort", () => reject(abortReason(signal)), { once: true })
      })
    })
    const caller = new AbortController()
    const deadline = new AbortController()
    const signal = AbortSignal.any([caller.signal, deadline.signal])

    const pending = serper({ query: "evidence query", signal, deadlineSignal: deadline.signal })
    await expectFetchCalls(2)
    caller.abort(new Error("User stopped search"))

    await expect(pending).rejects.toThrow("User stopped search")
    expect(resolverSignal?.aborted).toBe(true)
  })

  it("rejects caller cancellation while waiting for retryAfter", async () => {
    vi.useFakeTimers()
    try {
      const searchBody = {
        organic: [
          { title: "First", snippet: "First evidence", link: "https://first.example.com" },
          { title: "Fourth", snippet: "Fourth evidence", link: "https://www.google.com/goto?url=opaque" },
        ],
      }
      mockFetch
        .mockResolvedValueOnce(searchResponse(searchBody))
        .mockResolvedValueOnce(searchResponse({ ...searchBody, retryAfter: 60 }))
      const caller = new AbortController()
      const deadline = new AbortController()
      const signal = AbortSignal.any([caller.signal, deadline.signal])

      const pending = serper({ query: "evidence query", signal, deadlineSignal: deadline.signal })
      await expectFetchCalls(2)
      await vi.advanceTimersByTimeAsync(0)
      caller.abort(new Error("User stopped search"))

      await expect(pending).rejects.toThrow("User stopped search")
      expect(mockFetch).toHaveBeenCalledTimes(2)
    } finally {
      vi.useRealTimers()
    }
  })

  it("uses the original search deadline and returns resolved-only links when it expires", async () => {
    vi.useFakeTimers()
    try {
      const searchBody = {
        organic: [
          { title: "First", snippet: "First evidence", link: "https://first.example.com" },
          { title: "Fourth", snippet: "Fourth evidence", link: "https://www.google.com/goto?url=opaque" },
        ],
      }
      let resolverSignal: AbortSignal | undefined
      mockFetch.mockImplementationOnce(async () => {
        await new Promise((resolve) => setTimeout(resolve, 30_000))
        return searchResponse(searchBody)
      }).mockImplementationOnce((_input: RequestInfo | URL, init?: RequestInit) => {
        const signal = init?.signal
        resolverSignal = signal ?? undefined
        return new Promise<Response>((_resolve, reject) => {
          if (signal) signal.addEventListener("abort", () => reject(abortReason(signal)), { once: true })
        })
      })
      const caller = new AbortController()
      const deadline = new AbortController()
      setTimeout(() => deadline.abort(new DOMException("Search deadline exceeded", "TimeoutError")), 120_000)
      const signal = AbortSignal.any([caller.signal, deadline.signal])

      const pending = serper({ query: "evidence query", signal, deadlineSignal: deadline.signal })
      await vi.advanceTimersByTimeAsync(30_000)
      await expectFetchCalls(2)
      await vi.advanceTimersByTimeAsync(90_000)

      await expect(pending).resolves.toEqual([
        { title: "First", shortText: "First evidence", link: "https://first.example.com/" },
      ])
      expect(resolverSignal?.aborted).toBe(true)
    } finally {
      vi.useRealTimers()
    }
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
