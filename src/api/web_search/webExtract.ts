import {
  extractVisibleTextFromHtml,
  PdfExtractor,
  validateUrl,
} from "deep-search-core/search-extract/core"
import { config } from "../config.ts"
import { secureJsonParse } from "../helpers/secureJsonParse.ts"
import { MAX_WEB_SEARCH_RESULTS, normalizeWebSearchResults } from "./types.ts"
import {
  createScrapingAntClient,
  ScrapingAntRequestError,
  type ScrapingAntClient,
  type ScrapingAntMode,
} from "./scrapingAnt.ts"

const minimumUsableContentChars = 200
const maxJsonContentChars = 100_000
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
  links: Array<{ url: string; title: string }>
  retrievalMethod: PageRetrievalMethod
  scrapingAntCredits: number
}

class WebExtractionError extends Error {
  override readonly name = "WebExtractionError"
  readonly scrapingAntCredits: number

  constructor(
    message: string,
    scrapingAntCredits: number,
    options?: { cause?: unknown },
  ) {
    super(message, options)
    this.scrapingAntCredits = scrapingAntCredits
  }
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

// Tokenize complete tags so quoted `>` and tag-like attribute text stay inside
// their tag. Comments and raw-text elements cannot advertise research links.
function* pageTags(html: string) {
  const tags = /<!--[\s\S]*?(?:-->|$)|<\/?([a-z][\w:-]*)\b((?:[^"'<>]|"[^"]*"|'[^']*')*)>/gi
  for (let match = tags.exec(html); match; match = tags.exec(html)) {
    const name = match[1]?.toLowerCase()
    if (!name) continue
    const closing = match[0].startsWith("</")
    if (!closing && /^(?:script|style|template|textarea|title|xmp|iframe|noembed|noframes|noscript|plaintext)$/.test(name)) {
      if (name === "plaintext") return
      const end = new RegExp(`</${name}\\s*>`, "gi")
      end.lastIndex = tags.lastIndex
      const close = end.exec(html)
      if (!close) return
      tags.lastIndex = end.lastIndex
      continue
    }
    yield { name, closing, attributes: match[2], start: match.index, end: tags.lastIndex }
  }
}

function attributeValue(attributes: string, name: string): string | undefined {
  const attribute = /([^\s=/>]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+)))?/g
  for (const match of attributes.matchAll(attribute)) {
    if (match[1].toLowerCase() !== name) continue
    const value = match[2] ?? match[3] ?? match[4] ?? ""
    return extractVisibleTextFromHtml(`<span>${value.replaceAll("<", "&lt;")}</span>`)
  }
}

function pageLinks(html: string, pageUrl: URL): WebExtractResult["links"] {
  if (!html) return []
  let baseUrl = pageUrl
  for (const tag of pageTags(html)) {
    if (tag.name !== "base" || tag.closing) continue
    const href = attributeValue(tag.attributes, "href")
    if (href === undefined) continue
    try {
      baseUrl = new URL(href, pageUrl)
    } catch {
      // Invalid base syntax falls back to the document URL. Every resolved link
      // still passes the existing public-HTTPS validation below.
    }
    break
  }

  const sourceUrl = normalizeWebSearchResults([
    { title: "Source", shortText: "Source", link: pageUrl.href },
  ])[0]?.link
  const links: Array<{ url: string; title: string; priority: number; position: number }> = []
  const ancestors: Array<{ name: string; priority: number }> = []
  let anchor: { href: string; start: number; priority: number } | undefined
  const addLink = (href: string, title: string, priority: number, position: number) => {
    if (!href || href.startsWith("#")) return
    let url: URL
    try {
      url = new URL(href, baseUrl)
    } catch {
      return
    }
    const normalized = normalizeWebSearchResults([
      { title, shortText: title, link: url.href },
    ])[0]
    if (!normalized || normalized.link === sourceUrl) return
    const duplicate = links.findIndex(({ url }) => url === normalized.link)
    if (duplicate >= 0) {
      if (links[duplicate].priority >= priority) return
      links.splice(duplicate, 1)
    }
    links.push({ url: normalized.link, title: normalized.title, priority, position })
    // Scan beyond navigation while retaining only the best bounded candidates.
    links.sort((first, second) => second.priority - first.priority || first.position - second.position)
    if (links.length > MAX_WEB_SEARCH_RESULTS) links.pop()
  }
  const finishAnchor = (end: number) => {
    if (!anchor) return
    const { href, start, priority } = anchor
    anchor = undefined
    addLink(href, extractVisibleTextFromHtml(html.slice(start, end)) || href, priority, start)
  }

  for (const tag of pageTags(html)) {
    if (tag.name === "a") finishAnchor(tag.start)
    if (tag.closing) {
      const opening = ancestors.findLastIndex(({ name }) => name === tag.name)
      if (opening >= 0) ancestors.length = opening
      continue
    }
    const parentPriority = ancestors.at(-1)?.priority ?? 1
    const navigation = /^(?:nav|header|footer|aside)$/.test(tag.name) ||
      attributeValue(tag.attributes, "role")?.toLowerCase() === "navigation"
    const priority = navigation || parentPriority === 0 ? 0 :
      /^(?:main|article)$/.test(tag.name) ? 2 : parentPriority
    if (tag.name === "a") {
      const href = attributeValue(tag.attributes, "href")
      if (href !== undefined) anchor = { href, start: tag.end, priority }
    } else if (tag.name === "link" && isJsonContentType(attributeValue(tag.attributes, "type"))) {
      const href = attributeValue(tag.attributes, "href")
      if (href !== undefined) addLink(href, attributeValue(tag.attributes, "title") || href, priority, tag.start)
    }
    if (!/^(?:area|base|br|col|embed|hr|img|input|link|meta|param|source|track|wbr)$/.test(tag.name)) {
      ancestors.push({ name: tag.name, priority })
    }
  }
  finishAnchor(html.length)
  return links.map(({ url, title }) => ({ url, title }))
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

function isJsonContentType(contentType: string | undefined): boolean {
  return /^application\/(?:[a-z0-9!#$&^_.+-]+\+)?json$/.test(normalizedContentType(contentType) ?? "")
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
}): Promise<{ content: string; html: string; isJson?: boolean }> {
  if (isJsonContentType(params.contentType)) {
    const content = new TextDecoder("utf-8", { fatal: true }).decode(params.body)
    if (content.length > maxJsonContentChars) {
      throw new Error(`JSON document exceeded ${maxJsonContentChars} characters`)
    }
    secureJsonParse(content)
    // Keep numeric spelling, large identifiers, escaped strings, and fields
    // exactly as published rather than reserializing parsed JavaScript values.
    return { content, html: "", isJson: true }
  }
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

  return async function extract(params: {
    url: string
    signal?: AbortSignal
  }): Promise<WebExtractResult> {
    const parsedUrl = validateUrl(params.url)
    let scrapingAntCredits = 0

    for (const { mode, method } of retrievalStages) {
      const startedAt = now()

      try {
        const page = await deps.client.fetchPage({
          url: parsedUrl.href,
          mode,
          signal: params.signal,
        })
        scrapingAntCredits += page.credits ?? 0
        const { content, html, isJson } = await extractContent({
          body: page.body,
          contentType: page.contentType,
          pdfExtractor,
          signal: params.signal,
          url: parsedUrl,
        })
        const failure = isJson ? undefined : unusableReason({
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
          deps.log?.({ ...diagnostic, outcome: "failure", failure })
          continue
        }

        deps.log?.({ ...diagnostic, outcome: "success" })
        return {
          url: params.url,
          content,
          links: pageLinks(html, parsedUrl),
          retrievalMethod: method,
          scrapingAntCredits,
        }
      } catch (error) {
        const providerError =
          error instanceof ScrapingAntRequestError ? error : undefined
        scrapingAntCredits += providerError?.credits ?? 0
        deps.log?.({
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
        if (params.signal?.aborted) {
          throw new WebExtractionError(
            errorMessage(error),
            scrapingAntCredits,
            { cause: error },
          )
        }
      }
    }

    throw new WebExtractionError(
      `No retrieval method returned usable content for ${params.url}`,
      scrapingAntCredits,
    )
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
