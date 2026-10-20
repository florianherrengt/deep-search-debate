import z from "zod"
import PQueue from "p-queue"
import { config } from "../config.ts"
import { addAbortableQueueTask } from "../helpers/addAbortableQueueTask.ts"
import { createBoundedFetch } from "./boundedFetch.ts"
import {
  normalizeWebSearchResults,
  type WebSearchResult,
} from "./types.ts"

const boundedFetch = createBoundedFetch(
  config.webSearch.maxResponseBytes,
  (input, init) => globalThis.fetch(input, init),
)

const searxngResponseSchema = z.object({
  results: z.array(z.object({
    title: z.string(),
    url: z.string(),
    content: z.string(),
  })),
})

class SearchProviderResponseError extends Error {
  readonly provider = "SearXNG"

  constructor(detail?: string) {
    const detailSuffix = detail ? `: ${detail}` : ""
    super(`SearXNG search response did not match the expected format${detailSuffix}`)
    this.name = "SearchProviderResponseError"
  }
}

class SearchProviderError extends Error {
  readonly provider = "SearXNG"
  readonly status: number

  constructor(status: number, body?: string) {
    const bodySuffix = body ? `: ${body}` : ""
    super(`SearXNG search failed with HTTP ${status}${bodySuffix}`)
    this.name = "SearchProviderError"
    this.status = status
  }
}

async function searchSearxng(query: string, signal?: AbortSignal) {
  const baseUrl = config.webSearch.searxng.url?.trim() || "http://localhost:8080"
  const url = new URL("/search", baseUrl)
  url.searchParams.set("format", "json")
  url.searchParams.set("q", query)
  const requestUrl = new URL(url)
  requestUrl.searchParams.set("categories", config.webSearch.searxng.categories.join(","))
  const response = await boundedFetch(requestUrl, {
    headers: { accept: "application/json" },
    signal,
  })

  if (!response.ok) {
    const body = await response.text().then((raw) => {
      const text = raw.trim()
      return text.length > 300 ? `${text.slice(0, 300)}...` : text
    }).catch(() => "")
    const statusText = response.statusText ? ` ${response.statusText}` : ""
    const formattedError = `SearXNG search failed with HTTP ${response.status}${statusText}${body ? `: ${body}` : ""}`
    const bodyPart = formattedError.replace(/^.*?: /, "")
    const statusMatch = formattedError.match(/HTTP (\d+)/)
    throw new SearchProviderError(statusMatch ? Number.parseInt(statusMatch[1], 10) : 0, bodyPart)
  }

  const raw = await response.text()
  let parsed: unknown
  try { parsed = JSON.parse(raw) as unknown } catch { parsed = null }
  const result = searxngResponseSchema.safeParse(parsed)
  if (!result.success) throw new SearchProviderResponseError(result.error.message)
  return result.data.results.map((item) => ({
    title: item.title,
    url: item.url,
    description: item.content,
  }))
}

const searchQueue = new PQueue({
  concurrency: config.webSearch.searxng.maxConcurrentRequests,
  ...(config.webSearch.searxng.minIntervalMs > 0
    ? {
        interval: config.webSearch.searxng.minIntervalMs,
        intervalCap: 1,
        carryoverConcurrencyCount: true,
      }
    : {}),
})

export async function searxng(params: {
  query: string
  signal?: AbortSignal
}): Promise<WebSearchResult[]> {
  if (config.webSearch.searxng.url === undefined) {
    throw new Error("SearXNG is not configured")
  }
  const results = await addAbortableQueueTask(
    searchQueue,
    () => searchSearxng(params.query, params.signal),
    params.signal,
  )
  const mappedResults = results.map((result) => ({
    title: result.title,
    shortText: result.description,
    link: result.url,
  }))
  // Results without snippets cannot provide fallback evidence. Unsupported or
  // duplicate URLs are likewise omitted before anything reaches persistence.
  return normalizeWebSearchResults(mappedResults)
}
