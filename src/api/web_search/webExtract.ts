import {
  extractVisibleTextFromHtml,
  PdfExtractor,
  validateUrl,
} from "deep-search-core/search-extract"
import { config } from "../config.ts"
import {
  createScrapingAntClient,
  ScrapingAntRequestError,
  type ScrapingAntClient,
  type ScrapingAntMode,
} from "./scrapingAnt.ts"

const minimumUsableContentChars = 200
const retrievalStages = [
  { mode: "http", method: "scrapingant-http" },
  { mode: "browser-us", method: "scrapingant-browser-us" },
] as const satisfies ReadonlyArray<{
  mode: ScrapingAntMode
  method: string
}>

type PageRetrievalMethod = (typeof retrievalStages)[number]["method"]

export type PageRetrievalLog = {
  event: "page-retrieval-attempt"
  url: string
  domain: string
  method: PageRetrievalMethod
  outcome: "success" | "failure"
  latencyMs: number
  credits?: number
  providerStatusCode?: number
  failure?: string
}

export type WebExtractResult = {
  url: string
  content: string
  retrievalMethod: PageRetrievalMethod
}

type WebExtractorDeps = {
  client: ScrapingAntClient
  pdfExtractor?: Pick<PdfExtractor, "extract">
  now?: () => number
  log?: (entry: PageRetrievalLog) => void
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

function pageTitle(html: string): string {
  return (/<title\b[^>]*>([\s\S]*?)<\/title>/i.exec(html)?.[1] ?? "")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim()
}

function unusableReason(params: {
  html: string
  content: string
}): string | undefined {
  if (params.content.trim().length < minimumUsableContentChars) {
    return `Extracted content was shorter than ${minimumUsableContentChars} characters`
  }

  const title = pageTitle(params.html)
  const prominentText = `${title}\n${params.content.slice(0, 1_000)}`
  const challengePattern =
    /\b(?:access denied|attention required|captcha|checking your browser|cloudflare ray id|request (?:was )?blocked|unusual traffic|verify (?:that )?you are human)\b/i
  if (challengePattern.test(prominentText)) {
    return "Page contained an access-denied or anti-bot challenge"
  }

  const errorTitle = title.split(/\s+(?:\||–|—)\s+/u, 1)[0] ?? title
  const errorTitlePattern =
    /^(?:(?:4\d\d|5\d\d)(?:\s+[^|]*)?|bad gateway|error|gateway timeout|internal server error|not found|page not found|service unavailable)$/i
  if (errorTitlePattern.test(errorTitle)) {
    return `Page title indicated an error: ${title}`
  }
}

function roundedLatency(now: () => number, startedAt: number): number {
  return Math.max(0, Math.round(now() - startedAt))
}

function isPdfBody(body: Uint8Array): boolean {
  return new TextDecoder("latin1")
    .decode(body.subarray(0, 1_024))
    .includes("%PDF-")
}

function normalizedContentType(contentType: string | undefined): string | undefined {
  return contentType?.split(";", 1)[0]?.trim().toLowerCase()
}

function decodeTextDocument(body: Uint8Array, contentType: string | undefined): string {
  const mediaType = normalizedContentType(contentType)
  const supported = new Set([
    "text/html",
    "application/xhtml+xml",
    "text/plain",
    "text/markdown",
  ])
  if (mediaType !== undefined && !supported.has(mediaType)) {
    throw new Error(`Unsupported page content type: ${mediaType}`)
  }

  const text = new TextDecoder().decode(body)
  const replacementCount = text.split("\ufffd").length - 1
  if (
    text.includes("\0") ||
    (text.length > 0 && replacementCount / text.length > 0.01)
  ) {
    throw new Error("Page response was not valid text content")
  }
  return text
}

async function extractContent(params: {
  body: Uint8Array
  contentType?: string
  pdfExtractor: Pick<PdfExtractor, "extract">
  signal?: AbortSignal
  url: URL
}): Promise<{ content: string; html: string }> {
  if (isPdfBody(params.body)) {
    const result = await params.pdfExtractor.extract({
      url: params.url,
      loader: {},
      fetch: () =>
        Promise.resolve(
          new Response(new Uint8Array(params.body), {
            headers: params.contentType
              ? { "content-type": params.contentType }
              : undefined,
          }),
        ),
      signal: params.signal,
    })
    return { content: result?.content ?? "", html: "" }
  }

  const html = decodeTextDocument(params.body, params.contentType)
  if (normalizedContentType(params.contentType) === "text/plain") {
    return { content: html, html: "" }
  }
  return { content: extractVisibleTextFromHtml(html), html }
}

export function createWebExtractor(deps: WebExtractorDeps) {
  const now = deps.now ?? performance.now.bind(performance)
  const pdfExtractor = deps.pdfExtractor ?? new PdfExtractor()
  const log =
    deps.log ?? ((entry: PageRetrievalLog) => console.info("Page retrieval", entry))

  return async function extract(params: {
    url: string
    signal?: AbortSignal
  }): Promise<WebExtractResult> {
    const parsedUrl = validateUrl(params.url)

    for (const { mode, method } of retrievalStages) {
      const startedAt = now()

      try {
        const page = await deps.client.fetchPage({
          url: parsedUrl.href,
          mode,
          signal: params.signal,
        })
        const { content, html } = await extractContent({
          body: page.body,
          contentType: page.contentType,
          pdfExtractor,
          signal: params.signal,
          url: parsedUrl,
        })
        const failure = unusableReason({
          html,
          content,
        })
        const diagnostic = {
          event: "page-retrieval-attempt" as const,
          url: params.url,
          domain: parsedUrl.hostname,
          method,
          latencyMs: roundedLatency(now, startedAt),
          credits: page.credits,
        }

        if (failure !== undefined) {
          log({ ...diagnostic, outcome: "failure", failure })
          continue
        }

        log({ ...diagnostic, outcome: "success" })
        return { url: params.url, content, retrievalMethod: method }
      } catch (error) {
        const providerError =
          error instanceof ScrapingAntRequestError ? error : undefined
        log({
          event: "page-retrieval-attempt",
          url: params.url,
          domain: parsedUrl.hostname,
          method,
          outcome: "failure",
          latencyMs: roundedLatency(now, startedAt),
          credits: providerError?.credits,
          providerStatusCode: providerError?.providerStatusCode,
          failure: errorMessage(error),
        })
        if (params.signal?.aborted) throw error
      }
    }

    throw new Error(`No retrieval method returned usable content for ${params.url}`)
  }
}

const scrapingAntClient = createScrapingAntClient({
  apiKey: config.extraction.scrapingant.apiKey,
  queueWaitTimeoutMs: config.extraction.scrapingant.queueWaitTimeoutMs,
  requestTimeoutMs: config.extraction.scrapingant.requestTimeoutMs,
  maxResponseBytes: config.extraction.scrapingant.maxResponseBytes,
})

const pdfExtractor = new PdfExtractor({
  maxBytes: config.extraction.scrapingant.maxResponseBytes,
  parseTimeoutMs: config.extraction.scrapingant.requestTimeoutMs,
})

export const webExtract = createWebExtractor({
  client: scrapingAntClient,
  pdfExtractor,
})
