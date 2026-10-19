import { PassThrough } from "node:stream"
import https from "node:https"
import type { LookupAddress } from "node:dns"
import type { ClientRequest, IncomingMessage } from "node:http"
import { afterEach, describe, expect, it, vi } from "vitest"
import { createPageFetchClient, PageFetchRequestError } from "./pageFetch.ts"

const publicAddress: LookupAddress = { address: "93.184.216.34", family: 4 }
const defaults = {
  browserlessUrl: "http://browserless.test",
  browserlessToken: "private-token",
  queueWaitTimeoutMs: 1_000,
  requestTimeoutMs: 10_000,
  maxResponseBytes: 1024,
}
function response(statusCode: number, headers: IncomingMessage["headers"], body = "ok") {
  const stream = new PassThrough()
  Object.assign(stream, { statusCode, headers })
  queueMicrotask(() => { stream.end(body) })
  return stream as unknown as IncomingMessage
}
function requestMock(handler: (url: URL, options: https.RequestOptions, callback: (res: IncomingMessage) => void) => void) {
  const implementation = ((input: string | URL | https.RequestOptions, options: https.RequestOptions, callback: (res: IncomingMessage) => void) => {
    const url = input instanceof URL
      ? input
      : typeof input === "string"
        ? new URL(input)
        : (() => { throw new Error("Unexpected options-only HTTPS request") })()
    const req = new PassThrough() as unknown as ClientRequest
    req.end = ((..._args: unknown[]) => req) as ClientRequest["end"]
    handler(url, options, callback)
    return req
  })
  const mock = vi.fn(implementation)
  return mock as unknown as typeof https.request & { mock: { calls: unknown[][] } }
}
afterEach(() => vi.useRealTimers())

describe("pageFetch", () => {
  it("pins the HTTPS request to the validated DNS answer and returns response bytes", async () => {
    let requestOptions: https.RequestOptions | undefined
    const request = requestMock((_url, options, callback) => {
      requestOptions = options
      callback(response(200, { "content-type": "text/html; charset=utf-8" }, "<h1>ok</h1>"))
    })
    const client = createPageFetchClient({
      ...defaults,
      lookup: vi.fn(() => Promise.resolve([publicAddress])),
      request,
    })

    const page = await client.fetchPage({ url: "https://example.test/page", mode: "http" })

    expect(request).toHaveBeenCalledOnce()
    expect(requestOptions?.method).toBe("GET")
    expect(requestOptions?.headers).toMatchObject({ "Accept-Encoding": "identity" })
    expect(typeof requestOptions?.lookup).toBe("function")
    const pinnedLookup = vi.fn(requestOptions?.lookup)
    let pinnedAddress: unknown
    pinnedLookup("example.test", {}, (_error, address) => { pinnedAddress = address })
    expect(pinnedAddress).toBe("93.184.216.34")
    expect(page).toMatchObject({ contentType: "text/html; charset=utf-8" })
    expect(new TextDecoder().decode(page.body)).toBe("<h1>ok</h1>")
  })

  it("accepts and pins a public IPv6 literal without performing DNS", async () => {
    let requestOptions: https.RequestOptions | undefined
    const lookup = vi.fn(() => Promise.resolve([publicAddress]))
    const request = requestMock((_url, options, callback) => {
      requestOptions = options
      callback(response(200, { "content-type": "text/html" }, "ipv6"))
    })
    const client = createPageFetchClient({ ...defaults, lookup, request })

    await client.fetchPage({ url: "https://[2606:4700:4700::1111]/", mode: "http" })

    expect(lookup).not.toHaveBeenCalled()
    let pinnedAddress: unknown
    requestOptions?.lookup?.("2606:4700:4700::1111", {}, (_error, address) => {
      pinnedAddress = address
    })
    expect(pinnedAddress).toBe("2606:4700:4700::1111")
  })

  it("rejects a hostname if any DNS answer is private before making a request", async () => {
    const request = requestMock(() => { throw new Error("should not request") })
    const client = createPageFetchClient({
      ...defaults,
      lookup: () => Promise.resolve([publicAddress, { address: "127.0.0.1", family: 4 }]),
      request,
    })
    await expect(client.fetchPage({ url: "https://example.test", mode: "http" }))
      .rejects.toThrow("Page host resolves to a non-public address")
    expect(request).not.toHaveBeenCalled()
  })

  it("stops a pending DNS lookup when the caller aborts", async () => {
    let finishLookup: ((addresses: LookupAddress[]) => void) | undefined
    const request = requestMock(() => { throw new Error("should not request") })
    const client = createPageFetchClient({
      ...defaults,
      lookup: () => new Promise((resolve) => { finishLookup = resolve }),
      request,
    })
    const controller = new AbortController()
    const pending = client.fetchPage({ url: "https://example.test", mode: "http", signal: controller.signal })
    controller.abort()
    await expect(pending).rejects.toMatchObject({ name: "AbortError" })
    finishLookup?.([publicAddress])
    expect(request).not.toHaveBeenCalled()
  })

  it("times out during DNS resolution before making an HTTPS request", async () => {
    let finishLookup: ((addresses: LookupAddress[]) => void) | undefined
    const request = requestMock(() => { throw new Error("should not request") })
    const client = createPageFetchClient({
      ...defaults,
      requestTimeoutMs: 20,
      lookup: () => new Promise((resolve) => { finishLookup = resolve }),
      request,
    })
    const pending = client.fetchPage({ url: "https://example.test", mode: "http" })
    await expect(pending).rejects.toThrow("Page fetch timed out after 20ms")
    finishLookup?.([publicAddress])
    expect(request).not.toHaveBeenCalled()
  })

  it("serializes direct and Browserless requests across separate clients", async () => {
    let markFirstStarted: (() => void) | undefined
    const firstStarted = new Promise<void>((resolve) => { markFirstStarted = resolve })
    let releaseFirst: (() => void) | undefined
    const request = requestMock((_url, _options, callback) => {
      markFirstStarted?.()
      releaseFirst = () => callback(response(200, { "content-type": "text/html" }, "direct"))
    })
    const browserFetch = vi.fn<typeof fetch>().mockResolvedValue(new Response("rendered"))
    const directClient = createPageFetchClient({ ...defaults, lookup: () => Promise.resolve([publicAddress]), request })
    const browserClient = createPageFetchClient({ ...defaults, fetch: browserFetch })

    const direct = directClient.fetchPage({ url: "https://example.test/first", mode: "http" })
    await firstStarted
    const browser = browserClient.fetchPage({ url: "https://example.test/second", mode: "browser" })
    await Promise.resolve()
    expect(browserFetch).not.toHaveBeenCalled()
    releaseFirst?.()
    await expect(direct).resolves.toMatchObject({ contentType: "text/html" })
    await expect(browser).resolves.toBeDefined()
    expect(browserFetch).toHaveBeenCalledOnce()
  })

  it("aborts a queued request without starting its transport", async () => {
    let markFirstStarted: (() => void) | undefined
    const firstStarted = new Promise<void>((resolve) => { markFirstStarted = resolve })
    let releaseFirst: (() => void) | undefined
    const request = requestMock((_url, _options, callback) => {
      markFirstStarted?.()
      releaseFirst = () => callback(response(200, {}, "direct"))
    })
    const browserFetch = vi.fn<typeof fetch>()
    const client = createPageFetchClient({ ...defaults, lookup: () => Promise.resolve([publicAddress]), request })
    const browserClient = createPageFetchClient({ ...defaults, fetch: browserFetch })
    const direct = client.fetchPage({ url: "https://example.test/first", mode: "http" })
    await firstStarted
    const controller = new AbortController()
    const queued = browserClient.fetchPage({ url: "https://example.test/second", mode: "browser", signal: controller.signal })
    controller.abort()
    await expect(queued).rejects.toMatchObject({ name: "AbortError" })
    releaseFirst?.()
    await direct
    expect(browserFetch).not.toHaveBeenCalled()
  })

  it("expires a queued request without starting its transport and releases the queue slot", async () => {
    let markFirstStarted: (() => void) | undefined
    const firstStarted = new Promise<void>((resolve) => { markFirstStarted = resolve })
    let releaseFirst: (() => void) | undefined
    const request = requestMock((_url, _options, callback) => {
      markFirstStarted?.()
      releaseFirst = () => callback(response(200, {}, "direct"))
    })
    const browserFetch = vi.fn<typeof fetch>().mockResolvedValue(new Response("rendered"))
    const holder = createPageFetchClient({ ...defaults, lookup: () => Promise.resolve([publicAddress]), request })
    const waiting = createPageFetchClient({ ...defaults, queueWaitTimeoutMs: 30, fetch: browserFetch })
    const first = holder.fetchPage({ url: "https://example.test/first", mode: "http" })
    await firstStarted
    const expired = waiting.fetchPage({ url: "https://example.test/expired", mode: "browser" })
    await expect(expired).rejects.toThrow("Page fetch waited in the queue longer than 30ms")
    expect(browserFetch).not.toHaveBeenCalled()
    releaseFirst?.()
    await first

    const later = waiting.fetchPage({ url: "https://example.test/later", mode: "browser" })
    await expect(later).resolves.toBeDefined()
    expect(browserFetch).toHaveBeenCalledOnce()
  })

  it("revalidates each redirect and rejects a redirect to a private destination", async () => {
    const request = requestMock((url, _options, callback) => {
      callback(response(302, { location: "https://127.0.0.1/private" }))
      expect(url.hostname).toBe("example.test")
    })
    const client = createPageFetchClient({ ...defaults, lookup: () => Promise.resolve([publicAddress]), request })
    await expect(client.fetchPage({ url: "https://example.test", mode: "http" }))
      .rejects.toThrow("Page redirect URL is not publicly fetchable")
    expect(request).toHaveBeenCalledOnce()
  })

  it("rejects the sixth redirect", async () => {
    let count = 0
    const request = requestMock((_url, _options, callback) => {
      count += 1
      callback(response(302, { location: `/step-${count}` }))
    })
    const client = createPageFetchClient({ ...defaults, lookup: () => Promise.resolve([publicAddress]), request })
    await expect(client.fetchPage({ url: "https://example.test", mode: "http" }))
      .rejects.toThrow("Page fetch exceeded redirect limit")
    expect(request).toHaveBeenCalledTimes(6)
  })

  it("times out while reading a stalled HTTPS response body", async () => {
    const request = requestMock((_url, _options, callback) => {
      const stalled = new PassThrough()
      Object.assign(stalled, { statusCode: 200, headers: { "content-type": "text/html" } })
      callback(stalled as unknown as IncomingMessage)
    })
    const client = createPageFetchClient({
      ...defaults,
      requestTimeoutMs: 50,
      lookup: () => Promise.resolve([publicAddress]),
      request,
    })

    await expect(client.fetchPage({ url: "https://example.test", mode: "http" }))
      .rejects.toThrow("Page fetch timed out after 50ms")
  })

  it("enforces the response byte cap", async () => {
    const request = requestMock((_url, _options, callback) => {
      callback(response(200, { "content-type": "text/html" }, "0123456789"))
    })
    const client = createPageFetchClient({ ...defaults, maxResponseBytes: 5, lookup: () => Promise.resolve([publicAddress]), request })
    await expect(client.fetchPage({ url: "https://example.test", mode: "http" }))
      .rejects.toThrow("Page fetch response exceeded 5 bytes")
  })

  it("posts the rendering request to the authenticated Browserless content endpoint", async () => {
    const fetch = vi.fn<typeof globalThis.fetch>().mockResolvedValue(new Response("<main>rendered</main>", {
      headers: { "content-type": "text/html" },
    }))
    const client = createPageFetchClient({ ...defaults, fetch })
    const page = await client.fetchPage({ url: "https://example.test/article", mode: "browser" })
    expect(fetch).toHaveBeenCalledOnce()
    const [endpoint, init] = fetch.mock.calls[0] ?? []
    const endpointUrl = new URL(endpoint instanceof Request
      ? endpoint.url
      : endpoint instanceof URL
        ? endpoint.href
        : endpoint ?? "")
    expect(endpointUrl.pathname).toBe("/chromium/content")
    expect(endpointUrl.searchParams.get("token")).toBe("private-token")
    expect(endpointUrl.searchParams.get("timeout")).toBe("10000")
    expect(init?.method).toBe("POST")
    if (typeof init?.body !== "string") throw new Error("Browserless request body was not JSON text")
    expect(JSON.parse(init.body)).toEqual({
      url: "https://example.test/article",
      gotoOptions: { timeout: 5000, waitUntil: "networkidle2" },
      rejectResourceTypes: ["image", "media", "font"],
    })
    expect(new TextDecoder().decode(page.body)).toBe("<main>rendered</main>")
  })

  it("surfaces Browserless HTTP status without provider credit metadata", async () => {
    const client = createPageFetchClient({ ...defaults, fetch: vi.fn<typeof fetch>().mockResolvedValue(new Response("denied", { status: 401 })) })
    const error = await client.fetchPage({ url: "https://example.test", mode: "browser" }).catch((reason: unknown) => reason)
    expect(error).toBeInstanceOf(PageFetchRequestError)
    expect(error).toMatchObject({ providerStatusCode: 401 })
    expect(error).not.toHaveProperty("credits")
  })

  it("aborts an active Browserless request when the caller cancels", async () => {
    let observedSignal: AbortSignal | undefined
    const fetch = vi.fn<typeof globalThis.fetch>((_input, init) => {
      observedSignal = init?.signal ?? undefined
      return new Promise((_resolve, reject) => {
        observedSignal?.addEventListener("abort", () => reject(new DOMException("aborted", "AbortError")), { once: true })
      })
    })
    const client = createPageFetchClient({ ...defaults, fetch })
    const controller = new AbortController()
    const pending = client.fetchPage({ url: "https://example.test", mode: "browser", signal: controller.signal })
    await vi.waitFor(() => expect(fetch).toHaveBeenCalledOnce())
    controller.abort()
    await expect(pending).rejects.toMatchObject({ name: "AbortError" })
    expect(observedSignal?.aborted).toBe(true)
  })

  it("times out while reading a stalled Browserless response body", async () => {
    const fetch = vi.fn<typeof globalThis.fetch>().mockResolvedValue(new Response(
      new ReadableStream<Uint8Array>({ start() {} }),
      { headers: { "content-type": "text/html" } },
    ))
    const client = createPageFetchClient({ ...defaults, requestTimeoutMs: 30, fetch })
    await expect(client.fetchPage({ url: "https://example.test", mode: "browser" }))
      .rejects.toThrow("Page fetch timed out after 30ms")
  })
})
