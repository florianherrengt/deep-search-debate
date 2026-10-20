import { lookup as dnsLookup } from "node:dns/promises"
import https from "node:https"
import type { LookupAddress } from "node:dns"
import type { IncomingMessage } from "node:http"
import { isIP, type LookupFunction } from "node:net"
import puppeteer, { type Browser, type Page } from "puppeteer"
import PQueue from "p-queue"
import { addAbortableQueueTask } from "../helpers/addAbortableQueueTask.ts"
import { validatePublicIpAddress, validateUrl } from "./urlValidation.ts"

const browserlessPath = "/chromium/content"
const headlessTimeoutHeadroomMs = 5_000
const maximumRedirects = 5
const browserCloseTimeoutMs = 5_000

// One process-wide queue covers every client and both retrieval modes.
const pageFetchQueue = new PQueue({ concurrency: 1 })

export type PageFetchMode = "http" | "browser"

type PageFetchPage = {
  body: Uint8Array
  contentType?: string
}

export type PageFetchClient = {
  fetchPage(params: {
    url: string
    mode: PageFetchMode
    signal?: AbortSignal
  }): Promise<PageFetchPage>
}

type BrowserPageRunnerParams<T> = {
  url: string
  signal?: AbortSignal
  timeoutMs: number
  prepare?: (page: Page, signal: AbortSignal) => Promise<void>
  run: (page: Page, signal: AbortSignal) => Promise<T>
}

export type BrowserPageRunner = <T>(params: BrowserPageRunnerParams<T>) => Promise<T>

type ResolvedAddress = LookupAddress

type PageFetchClientConfig = {
  browserlessUrl: string
  browserlessToken: string
  queueWaitTimeoutMs: number
  requestTimeoutMs: number
  maxResponseBytes: number
  fetch?: typeof globalThis.fetch
  lookup?: (hostname: string) => Promise<ResolvedAddress[]>
  request?: typeof https.request
  connect?: typeof puppeteer.connect
}

export class PageFetchRequestError extends Error {
  readonly providerStatusCode?: number

  constructor(
    message: string,
    options?: { providerStatusCode?: number },
  ) {
    super(message)
    this.name = "PageFetchRequestError"
    this.providerStatusCode = options?.providerStatusCode
  }
}

/** Read an HTML snapshot only when it fits the byte limit, before CDP transfers it. */
export async function readBrowserPageHtml(page: Page, maxBytes: number): Promise<string> {
  if (!Number.isFinite(maxBytes) || maxBytes < 0) {
    throw new PageFetchRequestError("Rendered page size limit is invalid")
  }

  const result = await page.evaluate((byteLimit) => {
    let html = ""
    for (const node of document.childNodes) {
      if (node === document.documentElement) html += document.documentElement.outerHTML
      else html += new XMLSerializer().serializeToString(node)
    }
    const byteLength = new TextEncoder().encode(html).byteLength
    return { html: byteLength <= byteLimit ? html : null }
  }, maxBytes)

  if (result.html === null) {
    throw new PageFetchRequestError("Rendered page exceeds the response size limit")
  }
  return result.html
}

function createTimedSignal(signal: AbortSignal | undefined, timeoutMs: number) {
  const controller = new AbortController()
  let timedOut = false
  const forwardAbort = () => controller.abort()

  if (signal?.aborted) forwardAbort()
  else signal?.addEventListener("abort", forwardAbort, { once: true })

  const timeout = setTimeout(() => {
    timedOut = true
    controller.abort()
  }, timeoutMs)

  return {
    signal: controller.signal,
    timedOut: () => timedOut,
    cleanup() {
      clearTimeout(timeout)
      signal?.removeEventListener("abort", forwardAbort)
    },
  }
}

function abortError(): Error {
  const error = new Error("The operation was aborted")
  error.name = "AbortError"
  return error
}

function throwIfAborted(signal: AbortSignal): void {
  if (signal.aborted) throw abortError()
}

function waitForAbort<T>(promise: Promise<T>, signal: AbortSignal): Promise<T> {
  if (signal.aborted) return Promise.reject(abortError())

  return new Promise<T>((resolve, reject) => {
    const onAbort = () => reject(abortError())
    signal.addEventListener("abort", onAbort, { once: true })
    promise.then(resolve, reject).finally(() => {
      signal.removeEventListener("abort", onAbort)
    })
  })
}

async function readFetchResponseBytes(
  response: Response,
  maxBytes: number,
  signal: AbortSignal,
): Promise<Uint8Array> {
  const contentLength = Number(response.headers.get("content-length"))
  if (Number.isFinite(contentLength) && contentLength > maxBytes) {
    await response.body?.cancel().catch(() => undefined)
    throw new PageFetchRequestError(
      `Page fetch response exceeded ${maxBytes} bytes`,
    )
  }

  if (!response.body) {
    const buffer = await response.arrayBuffer()
    if (buffer.byteLength > maxBytes) {
      throw new PageFetchRequestError(
        `Page fetch response exceeded ${maxBytes} bytes`,
      )
    }
    return new Uint8Array(buffer)
  }

  const reader = response.body.getReader()
  const chunks: Uint8Array[] = []
  let bytesRead = 0
  const cancel = () => void reader.cancel().catch(() => undefined)
  signal.addEventListener("abort", cancel, { once: true })

  try {
    while (true) {
      throwIfAborted(signal)
      const chunk = await reader.read()
      throwIfAborted(signal)
      if (chunk.done) break
      bytesRead += chunk.value.byteLength
      if (bytesRead > maxBytes) {
        await reader.cancel().catch(() => undefined)
        throw new PageFetchRequestError(
          `Page fetch response exceeded ${maxBytes} bytes`,
        )
      }
      chunks.push(chunk.value)
    }
  } catch (error) {
    await reader.cancel().catch(() => undefined)
    throw error
  } finally {
    signal.removeEventListener("abort", cancel)
  }

  const body = new Uint8Array(bytesRead)
  let offset = 0
  for (const chunk of chunks) {
    body.set(chunk, offset)
    offset += chunk.byteLength
  }
  return body
}

function readIncomingResponseBytes(
  response: IncomingMessage,
  maxBytes: number,
  signal: AbortSignal,
): Promise<Uint8Array> {
  const contentLength = Number(response.headers["content-length"])
  if (Number.isFinite(contentLength) && contentLength > maxBytes) {
    response.destroy()
    return Promise.reject(
      new PageFetchRequestError(
        `Page fetch response exceeded ${maxBytes} bytes`,
      ),
    )
  }

  return new Promise((resolve, reject) => {
    const chunks: Uint8Array[] = []
    let bytesRead = 0
    let settled = false

    const finish = (error?: Error, body?: Uint8Array) => {
      if (settled) return
      settled = true
      signal.removeEventListener("abort", onAbort)
      if (error) reject(error)
      else resolve(body ?? new Uint8Array())
    }
    const onAbort = () => {
      response.destroy()
      finish(abortError())
    }

    signal.addEventListener("abort", onAbort, { once: true })
    if (signal.aborted) {
      onAbort()
      return
    }

    response.on("data", (chunk: Uint8Array | string) => {
      if (settled) return
      const bytes = typeof chunk === "string"
        ? new TextEncoder().encode(chunk)
        : chunk
      bytesRead += bytes.byteLength
      if (bytesRead > maxBytes) {
        response.destroy()
        finish(
          new PageFetchRequestError(
            `Page fetch response exceeded ${maxBytes} bytes`,
          ),
        )
        return
      }
      chunks.push(bytes)
    })
    response.once("error", (error: Error) => {
      finish(signal.aborted ? abortError() : error)
    })
    response.once("end", () => {
      const body = new Uint8Array(bytesRead)
      let offset = 0
      for (const chunk of chunks) {
        body.set(chunk, offset)
        offset += chunk.byteLength
      }
      finish(undefined, body)
    })
  })
}

function createPinnedLookup(address: ResolvedAddress): LookupFunction {
  return (_hostname, options, callback) => {
    if (options.all) {
      callback(null, [{ address: address.address, family: address.family }])
      return
    }
    callback(null, address.address, address.family)
  }
}

function safeTargetUrl(url: string): URL {
  try {
    return validateUrl(url)
  } catch {
    throw new PageFetchRequestError("Page URL is not publicly fetchable")
  }
}

function createDefaultLookup(hostname: string): Promise<ResolvedAddress[]> {
  return dnsLookup(hostname, { all: true, verbatim: true })
}

async function resolvePinnedPublicAddress(
  url: URL,
  lookup: (hostname: string) => Promise<ResolvedAddress[]>,
  signal: AbortSignal,
): Promise<ResolvedAddress> {
  throwIfAborted(signal)

  let addresses: ResolvedAddress[]
  try {
    const hostname = url.hostname.replace(/^\[|\]$/g, "")
    const family = isIP(hostname)
    addresses = family === 0
      ? await waitForAbort(lookup(hostname), signal)
      : [{ address: hostname, family }]
  } catch {
    if (signal.aborted) throw abortError()
    throw new PageFetchRequestError("Page host DNS lookup failed")
  }

  throwIfAborted(signal)
  if (addresses.length === 0) {
    throw new PageFetchRequestError("Page host has no public address")
  }
  try {
    for (const { address } of addresses) validatePublicIpAddress(address)
  } catch {
    throw new PageFetchRequestError("Page host resolves to a non-public address")
  }
  return addresses[0]
}

function requestHttpsResponse(
  request: typeof https.request,
  url: URL,
  address: ResolvedAddress,
  signal: AbortSignal,
): Promise<IncomingMessage> {
  return new Promise((resolve, reject) => {
    let settled = false
    const finish = (error?: Error, response?: IncomingMessage) => {
      if (settled) return
      settled = true
      if (error) reject(error)
      else if (response) resolve(response)
      else reject(new PageFetchRequestError("Page fetch returned no response"))
    }

    try {
      const outgoing = request(
        url,
        {
          method: "GET",
          headers: {
            Accept: "text/html,application/xhtml+xml,application/pdf,application/json,text/plain",
            "Accept-Encoding": "identity",
          },
          agent: false,
          lookup: createPinnedLookup(address),
          signal,
        },
        (response) => finish(undefined, response),
      )
      outgoing.once("error", (error) => finish(error))
      outgoing.end()
    } catch (error) {
      finish(error instanceof Error ? error : new Error("Request failed"))
    }
  })
}

function responseHeader(
  response: IncomingMessage,
  name: string,
): string | undefined {
  const value = response.headers[name.toLowerCase()]
  return Array.isArray(value) ? value.join(", ") : value
}

async function fetchHttpPage(params: {
  url: string
  signal: AbortSignal
  maxResponseBytes: number
  lookup: (hostname: string) => Promise<ResolvedAddress[]>
  request: typeof https.request
}): Promise<PageFetchPage> {
  let currentUrl = safeTargetUrl(params.url)

  for (let redirectsFollowed = 0; ; redirectsFollowed += 1) {
    throwIfAborted(params.signal)
    const address = await resolvePinnedPublicAddress(
      currentUrl,
      params.lookup,
      params.signal,
    )
    const response = await requestHttpsResponse(
      params.request,
      currentUrl,
      address,
      params.signal,
    )
    const statusCode = response.statusCode ?? 0

    if ([301, 302, 303, 307, 308].includes(statusCode)) {
      const location = responseHeader(response, "location")
      response.once("error", () => undefined)
      response.destroy()
      if (!location || redirectsFollowed >= maximumRedirects) {
        throw new PageFetchRequestError("Page fetch exceeded redirect limit", {
          providerStatusCode: statusCode,
        })
      }
      try {
        currentUrl = safeTargetUrl(new URL(location, currentUrl).href)
      } catch {
        throw new PageFetchRequestError("Page redirect URL is not publicly fetchable", {
          providerStatusCode: statusCode,
        })
      }
      continue
    }

    if (statusCode < 200 || statusCode >= 300) {
      response.once("error", () => undefined)
      response.destroy()
      throw new PageFetchRequestError(
        `Page fetch failed with HTTP ${statusCode}`,
        { providerStatusCode: statusCode },
      )
    }

    const body = await readIncomingResponseBytes(
      response,
      params.maxResponseBytes,
      params.signal,
    )
    return {
      body,
      contentType: responseHeader(response, "content-type"),
    }
  }
}

function buildBrowserlessRequestUrl(
  browserlessUrl: string,
  token: string,
  timeoutMs: number,
): URL {
  try {
    const endpoint = new URL(browserlessPath, browserlessUrl)
    endpoint.searchParams.set("token", token)
    endpoint.searchParams.set("timeout", String(timeoutMs))
    return endpoint
  } catch {
    throw new PageFetchRequestError("Browserless URL is invalid")
  }
}

function buildBrowserlessWebSocketUrl(
  browserlessUrl: string,
  token: string,
  timeoutMs: number,
): string {
  try {
    const endpoint = new URL("/chromium", browserlessUrl)
    endpoint.protocol = endpoint.protocol === "https:" ? "wss:" : "ws:"
    endpoint.searchParams.set("token", token)
    endpoint.searchParams.set("timeout", String(timeoutMs))
    return endpoint.href
  } catch {
    throw new PageFetchRequestError("Browserless URL is invalid")
  }
}

function validateNavigationUrl(url: string): void {
  try {
    validateUrl(url)
  } catch {
    throw new PageFetchRequestError("Browser navigation target is not publicly fetchable")
  }
}

async function configureBrowserPage(
  page: Page,
  signal: AbortSignal,
  lookup: (hostname: string) => Promise<ResolvedAddress[]>,
): Promise<void> {
  await page.setRequestInterception(true)
  page.on("request", (request) => {
    void (async () => {
      try {
        const rawUrl = request.url()
        // These are browser-local resources, not network destinations.
        if (/^(?:data:|blob:|about:blank$)/i.test(rawUrl)) {
          if (signal.aborted) await request.abort("aborted")
          else await request.continue()
          return
        }
        const target = validateUrl(rawUrl)
        await resolvePinnedPublicAddress(target, lookup, signal)
        if (signal.aborted) await request.abort("aborted")
        else await request.continue()
      } catch {
        await request.abort(signal.aborted ? "aborted" : "blockedbyclient").catch(() => undefined)
      }
    })()
  })
  page.on("popup", (popup) => { if (popup) void popup.close().catch(() => undefined) })
}

async function closeBrowser(browser: Browser): Promise<void> {
  let timeout: ReturnType<typeof setTimeout> | undefined
  await Promise.race([
    Promise.resolve().then(() => browser.close()).catch(() => undefined),
    new Promise<void>((resolve) => {
      timeout = setTimeout(resolve, browserCloseTimeoutMs)
    }),
  ])
  if (timeout) clearTimeout(timeout)
}

export function createPageFetchClient(
  config: PageFetchClientConfig,
): PageFetchClient & { withBrowserPage: BrowserPageRunner } {
  const fetchImpl = config.fetch ?? globalThis.fetch
  const lookup = config.lookup ?? createDefaultLookup
  const request = config.request ?? https.request
  const connect = config.connect ?? puppeteer.connect.bind(puppeteer)

  async function fetchPage({
    url,
    mode,
    signal,
  }: Parameters<PageFetchClient["fetchPage"]>[0]): Promise<PageFetchPage> {
    if (signal?.aborted) throw abortError()
    const validUrl = safeTargetUrl(url)
    const timedSignal = createTimedSignal(signal, config.requestTimeoutMs)

    try {
      if (mode === "http") {
        return await fetchHttpPage({
          url: validUrl.href,
          signal: timedSignal.signal,
          maxResponseBytes: config.maxResponseBytes,
          lookup,
          request,
        })
      }

      const browserTimeoutMs = Math.max(
        1,
        config.requestTimeoutMs - headlessTimeoutHeadroomMs,
      )
      const response = await fetchImpl(
        buildBrowserlessRequestUrl(
          config.browserlessUrl,
          config.browserlessToken,
          config.requestTimeoutMs,
        ),
        {
          method: "POST",
          headers: {
            Accept: "text/html,application/xhtml+xml,application/pdf,application/json,text/plain",
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            url: validUrl.href,
            gotoOptions: {
              timeout: browserTimeoutMs,
              waitUntil: "networkidle2",
            },
            rejectResourceTypes: ["image", "media", "font"],
          }),
          signal: timedSignal.signal,
        },
      )

      if (!response.ok) {
        await response.body?.cancel().catch(() => undefined)
        throw new PageFetchRequestError(
          `Browserless request failed with HTTP ${response.status}`,
          { providerStatusCode: response.status },
        )
      }

      return {
        body: await readFetchResponseBytes(
          response,
          config.maxResponseBytes,
          timedSignal.signal,
        ),
        contentType: response.headers.get("content-type") ?? undefined,
      }
    } catch (error) {
      if (error instanceof PageFetchRequestError) throw error
      if (signal?.aborted) throw abortError()
      if (timedSignal.timedOut()) {
        throw new PageFetchRequestError(
          `Page fetch timed out after ${config.requestTimeoutMs}ms`,
        )
      }
      throw new PageFetchRequestError("Page fetch transport failed")
    } finally {
      timedSignal.cleanup()
    }
  }

  async function withBrowserPage<T>(params: BrowserPageRunnerParams<T>): Promise<T> {
    if (params.signal?.aborted) throw abortError()
    validateNavigationUrl(params.url)
    if (!Number.isFinite(params.timeoutMs) || params.timeoutMs <= 0) {
      throw new PageFetchRequestError("Browser session timeout must be positive")
    }

    const queuedSignal = createTimedSignal(params.signal, config.queueWaitTimeoutMs)
    const queueTaskController = new AbortController()
    const cancelWhileQueued = () => queueTaskController.abort(queuedSignal.signal.reason)
    if (queuedSignal.signal.aborted) cancelWhileQueued()
    else queuedSignal.signal.addEventListener("abort", cancelWhileQueued, { once: true })
    return addAbortableQueueTask(
      pageFetchQueue,
      async () => {
        queuedSignal.signal.removeEventListener("abort", cancelWhileQueued)
        if (queuedSignal.signal.aborted) throw abortError()
        queuedSignal.cleanup()
        const timedSignal = createTimedSignal(params.signal, params.timeoutMs)
        let browser: Browser | undefined
        try {
          throwIfAborted(timedSignal.signal)
          const connection = connect({
            browserWSEndpoint: buildBrowserlessWebSocketUrl(
              config.browserlessUrl,
              config.browserlessToken,
              params.timeoutMs,
            ),
            protocolTimeout: Math.min(params.timeoutMs, config.requestTimeoutMs),
          })
          // Puppeteer cannot cancel a WebSocket handshake. Keep the global queue
          // permit until it settles, then close immediately if Stop/deadline won.
          browser = await connection
          throwIfAborted(timedSignal.signal)
          const page = await waitForAbort(browser.newPage(), timedSignal.signal)
          await waitForAbort(configureBrowserPage(page, timedSignal.signal, lookup), timedSignal.signal)
          page.setDefaultNavigationTimeout(Math.min(params.timeoutMs, config.requestTimeoutMs))
          page.setDefaultTimeout(Math.min(params.timeoutMs, config.requestTimeoutMs))
          if (params.prepare) {
            await waitForAbort(params.prepare(page, timedSignal.signal), timedSignal.signal)
          }
          await waitForAbort(page.goto(validateUrl(params.url).href, {
            waitUntil: "domcontentloaded",
            timeout: Math.min(params.timeoutMs, config.requestTimeoutMs),
          }), timedSignal.signal)
          throwIfAborted(timedSignal.signal)
          return await waitForAbort(params.run(page, timedSignal.signal), timedSignal.signal)
        } catch (error) {
          if (params.signal?.aborted) throw abortError()
          if (timedSignal.timedOut()) {
            throw new PageFetchRequestError(`Browser session timed out after ${params.timeoutMs}ms`)
          }
          if (error instanceof PageFetchRequestError) throw error
          throw new PageFetchRequestError("Browser session transport failed")
        } finally {
          timedSignal.cleanup()
          if (browser) {
            await closeBrowser(browser)
          }
        }
      },
      queueTaskController.signal,
    )
      .catch((error: unknown) => {
        if (params.signal?.aborted) throw abortError()
        if (queuedSignal.timedOut()) {
          throw new PageFetchRequestError(
            `Page fetch waited in the queue longer than ${config.queueWaitTimeoutMs}ms`,
          )
        }
        throw error
      })
      .finally(() => {
        queuedSignal.signal.removeEventListener("abort", cancelWhileQueued)
        queuedSignal.cleanup()
      })
  }

  return {
    withBrowserPage,
    fetchPage(params) {
      const queuedSignal = createTimedSignal(
        params.signal,
        config.queueWaitTimeoutMs,
      )
      return addAbortableQueueTask(
        pageFetchQueue,
        () => {
          if (queuedSignal.signal.aborted) throw abortError()
          queuedSignal.cleanup()
          return fetchPage(params)
        },
        queuedSignal.signal,
      )
        .catch((error: unknown) => {
          if (params.signal?.aborted) throw abortError()
          if (queuedSignal.timedOut()) {
            throw new PageFetchRequestError(
              `Page fetch waited in the queue longer than ${config.queueWaitTimeoutMs}ms`,
            )
          }
          throw error
        })
        .finally(() => queuedSignal.cleanup())
    },
  }
}
