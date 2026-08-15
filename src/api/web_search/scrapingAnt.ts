import {
  validateUrl,
} from "deep-search-core/search-extract"
import PQueue from "p-queue"
import { addAbortableQueueTask } from "../helpers/addAbortableQueueTask.ts"
import z from "zod"

const scrapingAntEndpoint = "https://api.scrapingant.com/v2/general"
const minimumProviderTimeoutSeconds = 5
const maximumProviderTimeoutSeconds = 60
const providerTimeoutHeadroomSeconds = 5

// One process-wide queue covers every client and both retrieval modes.
const scrapingAntRequestQueue = new PQueue({ concurrency: 1 })

export type ScrapingAntMode = "http" | "browser-us"

export type ScrapingAntPage = {
  body: Uint8Array
  contentType?: string
  credits?: number
}

export type ScrapingAntClient = {
  fetchPage(params: {
    url: string
    mode: ScrapingAntMode
    signal?: AbortSignal
  }): Promise<ScrapingAntPage>
}

type ScrapingAntClientConfig = {
  apiKey: string
  fetch?: typeof globalThis.fetch
  queueWaitTimeoutMs: number
  requestTimeoutMs: number
  maxResponseBytes: number
  endpoint?: string
}

export class ScrapingAntRequestError extends Error {
  readonly credits?: number
  readonly providerStatusCode?: number

  constructor(
    message: string,
    options?: {
      cause?: unknown
      credits?: number
      providerStatusCode?: number
    },
  ) {
    super(message, { cause: options?.cause })
    this.name = "ScrapingAntRequestError"
    this.credits = options?.credits
    this.providerStatusCode = options?.providerStatusCode
  }
}

const optionalCreditSchema = z.coerce.number().nonnegative()

function parseHeader(
  value: string | null,
  schema: z.ZodType<number, unknown>,
): number | undefined {
  if (value === null || value.trim() === "") return
  const result = schema.safeParse(value)
  return result.success ? result.data : undefined
}

function providerTimeoutSeconds(requestTimeoutMs: number): number {
  return Math.max(
    minimumProviderTimeoutSeconds,
    Math.min(
      maximumProviderTimeoutSeconds,
      Math.floor(requestTimeoutMs / 1_000) - providerTimeoutHeadroomSeconds,
    ),
  )
}

function createTimedSignal(signal: AbortSignal | undefined, timeoutMs: number) {
  const controller = new AbortController()
  let timedOut = false
  const forwardAbort = () => controller.abort(signal?.reason)

  if (signal?.aborted) forwardAbort()
  else signal?.addEventListener("abort", forwardAbort, { once: true })

  const timeout = setTimeout(() => {
    timedOut = true
    controller.abort(new Error("ScrapingAnt request timed out"))
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

function buildRequestUrl(
  endpoint: string,
  targetUrl: string,
  mode: ScrapingAntMode,
  timeoutMs: number,
): URL {
  // ScrapingAnt accepts only cookie names/values in the `cookies` query param:
  // `name=value;name2=value2` (URLSearchParams handles encoding). Treat cookies
  // as per-request; carry response cookies forward rather than assuming that
  // ScrapingAnt persists them. See https://docs.scrapingant.com/custom-cookies.
  const url = new URL(endpoint)
  url.searchParams.set("url", validateUrl(targetUrl).href)
  url.searchParams.set("browser", mode === "browser-us" ? "true" : "false")
  url.searchParams.set("timeout", String(providerTimeoutSeconds(timeoutMs)))

  if (mode === "browser-us") {
    url.searchParams.set("proxy_type", "datacenter")
    url.searchParams.set("proxy_country", "US")
    for (const resource of ["image", "media", "font"]) {
      url.searchParams.append("block_resource", resource)
    }
  }

  return url
}

function responseMetadata(response: Response) {
  return {
    credits: parseHeader(
      response.headers.get("ant-credits-cost"),
      optionalCreditSchema,
    ),
  }
}

async function readResponseBytes(
  response: Response,
  maxBytes: number,
  signal: AbortSignal,
): Promise<Uint8Array | null> {
  const contentLength = Number(response.headers.get("content-length"))
  if (Number.isFinite(contentLength) && contentLength > maxBytes) {
    await response.body?.cancel()
    return null
  }

  if (!response.body) {
    const buffer = await response.arrayBuffer()
    return buffer.byteLength <= maxBytes ? new Uint8Array(buffer) : null
  }

  const reader = response.body.getReader()
  const chunks: Uint8Array[] = []
  let bytesRead = 0
  const cancel = () => void reader.cancel(signal.reason).catch(() => undefined)
  signal.addEventListener("abort", cancel, { once: true })

  try {
    while (true) {
      signal.throwIfAborted()
      const chunk = await reader.read()
      signal.throwIfAborted()
      if (chunk.done) break
      bytesRead += chunk.value.byteLength
      if (bytesRead > maxBytes) {
        await reader.cancel()
        return null
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

export function createScrapingAntClient(
  config: ScrapingAntClientConfig,
): ScrapingAntClient {
  const endpoint = config.endpoint ?? scrapingAntEndpoint
  const fetchImpl = config.fetch ?? globalThis.fetch

  async function fetchPage({
    url,
    mode,
    signal,
  }: Parameters<ScrapingAntClient["fetchPage"]>[0]) {
    signal?.throwIfAborted()
    const requestUrl = buildRequestUrl(
      endpoint,
      url,
      mode,
      config.requestTimeoutMs,
    )
    const timedSignal = createTimedSignal(signal, config.requestTimeoutMs)
    let metadata: ReturnType<typeof responseMetadata> = {
      credits: undefined,
    }

    try {
      const response = await fetchImpl(requestUrl, {
        headers: {
          Accept: "text/html,application/xhtml+xml,application/pdf,text/plain",
          "x-api-key": config.apiKey,
        },
        signal: timedSignal.signal,
      })
      metadata = responseMetadata(response)

      if (!response.ok) {
        await response.body?.cancel().catch(() => undefined)
        throw new ScrapingAntRequestError(
          `ScrapingAnt request failed with HTTP ${response.status}`,
          {
            credits: metadata.credits,
            providerStatusCode: response.status,
          },
        )
      }

      const body = await readResponseBytes(
        response,
        config.maxResponseBytes,
        timedSignal.signal,
      )
      if (body === null) {
        throw new ScrapingAntRequestError(
          `ScrapingAnt response exceeded ${config.maxResponseBytes} bytes`,
          {
            credits: metadata.credits,
          },
        )
      }

      return {
        body,
        contentType: response.headers.get("content-type") ?? undefined,
        ...metadata,
      }
    } catch (error) {
      if (error instanceof ScrapingAntRequestError) throw error
      if (signal?.aborted) throw error
      if (timedSignal.timedOut()) {
        throw new ScrapingAntRequestError(
          `ScrapingAnt request timed out after ${config.requestTimeoutMs}ms`,
          {
            cause: error,
            credits: metadata.credits,
          },
        )
      }
      throw new ScrapingAntRequestError("ScrapingAnt transport failed", {
        cause: error,
        credits: metadata.credits,
      })
    } finally {
      timedSignal.cleanup()
    }
  }

  return {
    fetchPage(params) {
      const queuedSignal = createTimedSignal(
        params.signal,
        config.queueWaitTimeoutMs,
      )
      return addAbortableQueueTask(
        scrapingAntRequestQueue,
        () => {
          queuedSignal.signal.throwIfAborted()
          queuedSignal.cleanup()
          return fetchPage(params)
        },
        queuedSignal.signal,
      )
        .catch((error: unknown) => {
          if (queuedSignal.timedOut()) {
            throw new ScrapingAntRequestError(
              `ScrapingAnt request waited in the queue longer than ${config.queueWaitTimeoutMs}ms`,
              { cause: error },
            )
          }
          throw error
        })
        .finally(() => queuedSignal.cleanup())
    },
  }
}
