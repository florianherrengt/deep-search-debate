import { afterEach, describe, expect, it, vi } from "vitest"
import {
  createScrapingAntClient,
  ScrapingAntRequestError,
} from "./scrapingAnt.ts"

function createClient(
  fetch: typeof globalThis.fetch,
  options?: {
    maxResponseBytes?: number
    queueWaitTimeoutMs?: number
    requestTimeoutMs?: number
  },
) {
  return createScrapingAntClient({
    apiKey: "secret-key",
    endpoint: "https://scrapingant.test/v2/general",
    fetch,
    maxResponseBytes: options?.maxResponseBytes ?? 2_000_000,
    queueWaitTimeoutMs: options?.queueWaitTimeoutMs ?? 120_000,
    requestTimeoutMs: options?.requestTimeoutMs ?? 35_000,
  })
}

function parsedRequestUrl(input: string | URL | Request | undefined): URL {
  if (typeof input === "string") return new URL(input)
  if (input instanceof URL) return input
  if (input instanceof Request) return new URL(input.url)
  throw new Error("Expected a ScrapingAnt request URL")
}

afterEach(() => {
  vi.useRealTimers()
  vi.restoreAllMocks()
})

describe("ScrapingAnt client", () => {
  it("uses the runtime fetch implementation by default", async () => {
    const fetch = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(new Response("<html>page</html>"))
    const client = createScrapingAntClient({
      apiKey: "secret-key",
      endpoint: "https://scrapingant.test/v2/general",
      maxResponseBytes: 2_000_000,
      queueWaitTimeoutMs: 120_000,
      requestTimeoutMs: 35_000,
    })

    await client.fetchPage({
      url: "https://example.com/page",
      mode: "http",
    })

    expect(fetch).toHaveBeenCalledOnce()
  })

  it("limits all clients and retrieval modes to one active provider call", async () => {
    let activeRequests = 0
    let maximumActiveRequests = 0
    const releases: Array<() => void> = []
    const fetch = vi.fn<typeof globalThis.fetch>().mockImplementation(
      async () => {
        activeRequests += 1
        maximumActiveRequests = Math.max(
          maximumActiveRequests,
          activeRequests,
        )
        await new Promise<void>((resolve) => releases.push(resolve))
        activeRequests -= 1
        return new Response("<html>page</html>")
      },
    )
    const firstClient = createClient(fetch)
    const secondClient = createClient(fetch)

    const requests = [
      firstClient.fetchPage({
        url: "https://example.com/one",
        mode: "http",
      }),
      secondClient.fetchPage({
        url: "https://example.com/two",
        mode: "browser-us",
      }),
      firstClient.fetchPage({
        url: "https://example.com/three",
        mode: "http",
      }),
    ]

    await vi.waitFor(() => expect(fetch).toHaveBeenCalledTimes(1))
    expect(activeRequests).toBe(1)
    releases.shift()?.()
    await vi.waitFor(() => expect(fetch).toHaveBeenCalledTimes(2))
    expect(activeRequests).toBe(1)
    releases.shift()?.()
    await vi.waitFor(() => expect(fetch).toHaveBeenCalledTimes(3))
    expect(activeRequests).toBe(1)
    releases.shift()?.()

    await Promise.all(requests)
    expect(maximumActiveRequests).toBe(1)
    expect(activeRequests).toBe(0)
  })

  it("makes the cheap request without browser rendering or country routing", async () => {
    const fetch = vi.fn<typeof globalThis.fetch>().mockResolvedValue(
      new Response("<html>page</html>", {
        headers: {
          "ant-credits-cost": "1",
          "content-type": "text/html; charset=utf-8",
        },
      }),
    )

    const page = await createClient(fetch).fetchPage({
      url: "https://example.com/page",
      mode: "http",
    })

    const [input, init] = fetch.mock.calls[0] ?? []
    const requestUrl = parsedRequestUrl(input)
    expect(requestUrl.searchParams.get("url")).toBe(
      "https://example.com/page",
    )
    expect(requestUrl.searchParams.get("browser")).toBe("false")
    expect(requestUrl.searchParams.has("proxy_type")).toBe(false)
    expect(requestUrl.searchParams.has("proxy_country")).toBe(false)
    const headers = new Headers(init?.headers)
    expect(headers.get("x-api-key")).toBe("secret-key")
    expect(headers.get("accept")).toContain("application/pdf")
    expect(requestUrl.searchParams.has("x-api-key")).toBe(false)
    expect(page).toEqual({
      body: new TextEncoder().encode("<html>page</html>"),
      contentType: "text/html; charset=utf-8",
      credits: 1,
    })
  })

  it("uses browser rendering with a US datacenter proxy at the second tier", async () => {
    const fetch = vi
      .fn<typeof globalThis.fetch>()
      .mockResolvedValue(new Response("<html>rendered</html>"))

    await createClient(fetch).fetchPage({
      url: "https://example.com/page",
      mode: "browser-us",
    })

    const requestUrl = parsedRequestUrl(fetch.mock.calls[0]?.[0])
    expect(requestUrl.searchParams.get("browser")).toBe("true")
    expect(requestUrl.searchParams.get("proxy_type")).toBe("datacenter")
    expect(requestUrl.searchParams.get("proxy_country")).toBe("US")
    expect(requestUrl.searchParams.getAll("block_resource")).toEqual([
      "image",
      "media",
      "font",
    ])
  })

  it("cancels a provider error response and preserves available cost metadata", async () => {
    const cancel = vi.fn()
    const stream = new ReadableStream<Uint8Array>({ cancel })
    const fetch = vi.fn<typeof globalThis.fetch>().mockResolvedValue(
      new Response(stream, {
        status: 423,
        headers: { "ant-credits-cost": "10" },
      }),
    )

    const promise = createClient(fetch).fetchPage({
      url: "https://example.com/page",
      mode: "browser-us",
    })

    await expect(promise).rejects.toMatchObject({
      message: "ScrapingAnt request failed with HTTP 423",
      credits: 10,
      providerStatusCode: 423,
    })
    expect(cancel).toHaveBeenCalledOnce()
  })

  it("cancels a response that exceeds the configured size limit", async () => {
    const cancel = vi.fn()
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new TextEncoder().encode("x".repeat(101)))
      },
      cancel,
    })
    const fetch = vi
      .fn<typeof globalThis.fetch>()
      .mockResolvedValue(new Response(stream))

    const promise = createClient(fetch, { maxResponseBytes: 100 }).fetchPage({
      url: "https://example.com/page",
      mode: "http",
    })

    await expect(promise).rejects.toThrow(
      "ScrapingAnt response exceeded 100 bytes",
    )
    expect(cancel).toHaveBeenCalledOnce()
  })

  it("aborts timed-out work and removes its timeout", async () => {
    vi.useFakeTimers()
    const fetch = vi.fn<typeof globalThis.fetch>().mockImplementation(
      async (_input, init) =>
        await new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener(
            "abort",
            () => reject(new Error("request aborted")),
            { once: true },
          )
        }),
    )

    const promise = createClient(fetch, { requestTimeoutMs: 20 }).fetchPage({
      url: "https://example.com/page",
      mode: "http",
    })
    const outcome = promise.then(
      () => undefined,
      (error: unknown) => error,
    )

    await vi.advanceTimersByTimeAsync(20)
    expect(await outcome).toEqual(
      expect.objectContaining({
        name: "ScrapingAntRequestError",
        message: "ScrapingAnt request timed out after 20ms",
      }),
    )
    expect(vi.getTimerCount()).toBe(0)
  })

  it("cancels and rejects a response body that stalls until timeout", async () => {
    vi.useFakeTimers()
    const cancel = vi.fn()
    const fetch = vi.fn<typeof globalThis.fetch>().mockResolvedValue(
      new Response(new ReadableStream<Uint8Array>({ cancel })),
    )
    const promise = createClient(fetch, { requestTimeoutMs: 20 }).fetchPage({
      url: "https://example.com/page",
      mode: "http",
    })
    const outcome = promise.then(
      () => undefined,
      (error: unknown) => error,
    )

    await vi.advanceTimersByTimeAsync(20)

    expect(await outcome).toEqual(expect.objectContaining({
      name: "ScrapingAntRequestError",
      message: "ScrapingAnt request timed out after 20ms",
    }))
    expect(cancel).toHaveBeenCalledOnce()
    expect(vi.getTimerCount()).toBe(0)
  })

  it("removes work that waits too long for the provider slot", async () => {
    vi.useFakeTimers()
    const releases: Array<() => void> = []
    const fetch = vi.fn<typeof globalThis.fetch>().mockImplementation(
      async () => {
        await new Promise<void>((resolve) => releases.push(resolve))
        return new Response("<html>page</html>")
      },
    )
    const client = createClient(fetch, {
      queueWaitTimeoutMs: 20,
      requestTimeoutMs: 1_000,
    })
    const first = client.fetchPage({
      url: "https://example.com/first",
      mode: "http",
    })
    await vi.waitFor(() => expect(fetch).toHaveBeenCalledOnce())

    let queuedError: unknown
    const second = client
      .fetchPage({
        url: "https://example.com/second",
        mode: "http",
      })
      .catch((error: unknown) => {
        queuedError = error
      })

    await vi.advanceTimersByTimeAsync(20)
    releases.shift()?.()
    await first
    await vi.waitFor(() => {
      if (queuedError === undefined && fetch.mock.calls.length < 2) {
        throw new Error("Queued request has not settled or started")
      }
    })
    releases.shift()?.()
    await second

    expect(queuedError).toEqual(
      expect.objectContaining({
        name: "ScrapingAntRequestError",
        message: "ScrapingAnt request waited in the queue longer than 20ms",
      }),
    )
    expect(fetch).toHaveBeenCalledOnce()
    expect(vi.getTimerCount()).toBe(0)
  })

  it("clears its timeout after an immediate transport failure", async () => {
    vi.useFakeTimers()
    const fetch = vi
      .fn<typeof globalThis.fetch>()
      .mockRejectedValue(new Error("connection reset"))

    await expect(
      createClient(fetch).fetchPage({
        url: "https://example.com/page",
        mode: "http",
      }),
    ).rejects.toBeInstanceOf(ScrapingAntRequestError)
    expect(vi.getTimerCount()).toBe(0)
  })

  it("releases the provider slot after a failed request", async () => {
    const fetch = vi
      .fn<typeof globalThis.fetch>()
      .mockRejectedValueOnce(new Error("connection reset"))
      .mockResolvedValueOnce(new Response("<html>recovered</html>"))
    const client = createClient(fetch)

    await expect(
      client.fetchPage({
        url: "https://example.com/failed",
        mode: "http",
      }),
    ).rejects.toBeInstanceOf(ScrapingAntRequestError)
    await expect(
      client.fetchPage({
        url: "https://example.com/recovered",
        mode: "http",
      }),
    ).resolves.toMatchObject({
      body: new TextEncoder().encode("<html>recovered</html>"),
    })
    expect(fetch).toHaveBeenCalledTimes(2)
  })
})
