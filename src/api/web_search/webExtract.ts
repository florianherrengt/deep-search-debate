import { config } from "../config.ts"
import type { Page } from "puppeteer"
import { secureJsonParse } from "../helpers/secureJsonParse.ts"
import { extractVisibleTextFromHtml } from "./htmlText.ts"
import { PdfExtractor } from "./pdfExtraction.ts"
import { validateUrl } from "./urlValidation.ts"
import { canonicalUrl, MAX_WEB_SEARCH_RESULTS, normalizeWebSearchResults } from "./types.ts"
import {
  createPageFetchClient,
  PageFetchRequestError,
  readBrowserPageHtml,
  type PageFetchClient,
  type PageFetchMode,
  type BrowserPageRunner,
} from "./pageFetch.ts"

const minimumUsableContentChars = 200
const maxJsonContentChars = 100_000
const retrievalStages = [
  { mode: "http", method: "http" },
  { mode: "browser", method: "browserless" },
] as const satisfies ReadonlyArray<{
  mode: PageFetchMode
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
  providerStatusCode?: number
  failure?: string
}

export type WebExtractResult = {
  url: string
  content: string
  links: Array<{ url: string; title: string }>
  retrievalMethod: PageRetrievalMethod
}

export class WebExtractionError extends Error {
  override readonly name = "WebExtractionError"

  constructor(
    message: string,
    options: {
      cause?: unknown
      observedLinks?: WebExtractResult["links"]
      recoveryReason?: string
      recoveryStatus?: string
    } = {},
  ) {
    super(message, { cause: options.cause })
    this.observedLinks = options.observedLinks ?? []
    this.recoveryReason = options.recoveryReason
    this.recoveryStatus = options.recoveryStatus
  }

  readonly observedLinks: WebExtractResult["links"]
  readonly recoveryReason?: string
  readonly recoveryStatus?: string
}

type WebExtractorDeps = {
  client: PageFetchClient
  withBrowserPage?: BrowserPageRunner
  pdfExtractor?: Pick<PdfExtractor, "extract">
  now?: () => number
  log?: (entry: PageRetrievalLog) => void
}

export type BrowserRecovery = {
  prepare: (page: Page, signal: AbortSignal) => Promise<void>
  recover: (page: Page, signal: AbortSignal) => Promise<{
    html?: string
    links: Array<{ url: string; title: string }>
    status: string
    reason?: string
  }>
}

const browserRecoveryReasons = new Set([
  "unsupported-challenge", "missing-api-key", "attempt-limit", "attempt-already-reserved",
  "solver-failed", "solver-timeout", "solver-unavailable",
  "action-limit", "link-handed-off", "browser-timeout", "cancelled",
])

function safeRecoveryReason(reason: string | undefined): string | undefined {
  return reason && browserRecoveryReasons.has(reason) ? reason : undefined
}

function safeRecoveryStatus(status: string): string | undefined {
  return status === "extracted" || status === "unsupported-captcha" || status === "action-limit"
    ? status
    : undefined
}

function normalizeObservedLinks(
  value: unknown,
  sourceUrl: URL,
): WebExtractResult["links"] {
  if (!Array.isArray(value)) return []
  const candidates = value.flatMap((item) => {
    if (item === null || typeof item !== "object") return []
    const candidate = item as Record<string, unknown>
    if (typeof candidate.url !== "string" || typeof candidate.title !== "string") return []
    return [{ link: candidate.url, title: candidate.title, shortText: candidate.title }]
  })
  const source = canonicalUrl(sourceUrl.href)
  return normalizeWebSearchResults(candidates)
    .filter(({ link }) => link !== source)
    .map(({ link, title }) => ({ url: link, title }))
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
function* pageTags(
  html: string,
  onRawText?: (name: string, start: number, end: number) => void,
) {
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
      onRawText?.(name, tags.lastIndex, close?.index ?? html.length)
      if (!close) return
      tags.lastIndex = end.lastIndex
      continue
    }
    yield { name, closing, attributes: match[2], start: match.index, end: tags.lastIndex }
  }
}

function pageAttributes(attributes: string) {
  return attributes.matchAll(/([^\s=/>]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+)))?/g)
}

function attributeValue(attributes: string, name: string): string | undefined {
  for (const match of pageAttributes(attributes)) {
    if (match[1].toLowerCase() !== name) continue
    const value = match[2] ?? match[3] ?? match[4] ?? ""
    return extractVisibleTextFromHtml(`<span>${value.replaceAll("<", "&lt;")}</span>`)
  }
}

function htmlForTextExtraction(html: string): string {
  const edits: Array<{ start: number; end: number; text: string }> = []
  for (const tag of pageTags(html, (name, start, end) => {
    if (name !== "script" && name !== "style") return
    const raw = html.slice(start, end)
    if (raw.includes("\0")) edits.push({ start, end, text: raw.replaceAll("\0", "") })
  })) {
    if (tag.closing) continue
    for (const attribute of pageAttributes(tag.attributes)) {
      if (attribute[1].toLowerCase() !== "class") continue
      // Ignore CSS variable declarations embedded in generated class tokens,
      // while preserving semantic classes such as popover.
      const text = attribute[0].replace(/\[--[\w-]+:[^\]\s]*\]/g, "")
      if (text === attribute[0]) continue
      const start = tag.end - tag.attributes.length - 1 + attribute.index
      edits.push({ start, end: start + attribute[0].length, text })
    }
  }

  const parts: string[] = []
  let cursor = 0
  for (const edit of edits) {
    parts.push(html.slice(cursor, edit.start), edit.text)
    cursor = edit.end
  }
  parts.push(html.slice(cursor))
  return parts.join("")
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
  const errorTitle = title.split(/\s+(?:\||–|—)\s+/u, 1)[0] ?? title
  const challengePattern =
    /\b(?:access denied|attention required|checking your browser|cloudflare ray id|request (?:was )?blocked|unusual traffic|verify (?:that )?you are human)\b/i
  // CAPTCHA is also a documentation topic; require a verification instruction.
  const captchaChallengePattern =
    /^(?:captcha verification (?:is )?required|(?:please )?(?:solve|complete) (?:a |the |this )?captcha\b)/i
  if (
    /^client challenge$/i.test(errorTitle) ||
    challengePattern.test(prominentText) ||
    captchaChallengePattern.test(title) ||
    captchaChallengePattern.test(params.content.trimStart())
  ) {
    return "Page contained an access-denied or anti-bot challenge"
  }

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
  if (text.length > 0 && replacementCount / text.length > 0.01) {
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
  const plainText = normalizedContentType(params.contentType) === "text/plain"
  const textHtml = plainText ? html : htmlForTextExtraction(html)
  // NULs in ignored script/style state are harmless; visible or untyped binary
  // NULs must still fail before the HTML parser can silently discard them.
  if (textHtml.includes("\0")) {
    throw new Error("Page response was not valid text content")
  }
  return {
    content: plainText ? textHtml : extractVisibleTextFromHtml(textHtml),
    html: plainText ? "" : html,
  }
}

export function createWebExtractor(deps: WebExtractorDeps) {
  const now = deps.now ?? performance.now.bind(performance)
  const pdfExtractor = deps.pdfExtractor ?? new PdfExtractor()

  return async function extract(params: {
    url: string
    signal?: AbortSignal
    browserRecovery?: BrowserRecovery
  }): Promise<WebExtractResult> {
    const parsedUrl = validateUrl(params.url)
    let observedLinks: WebExtractResult["links"] = []
    let observedRecoveryReason: string | undefined
    let observedRecoveryStatus: string | undefined

    for (const { mode, method } of retrievalStages) {
      const startedAt = now()
      let attemptObservedLinks: WebExtractResult["links"] = []

      try {
        if (mode === "browser" && deps.withBrowserPage && params.browserRecovery) {
          const recovery = params.browserRecovery
          // Keep the ordinary stateless Browserless render as the first browser
          // tier. The interactive CDP session is only needed when that render
          // still shows a challenge or otherwise unusable content.
          let rendered: Awaited<ReturnType<typeof extractContent>> | undefined
          try {
            const renderedPage = await deps.client.fetchPage({
              url: parsedUrl.href,
              mode,
              signal: params.signal,
            })
            rendered = await extractContent({
              body: renderedPage.body,
              contentType: renderedPage.contentType,
              pdfExtractor,
              signal: params.signal,
              url: parsedUrl,
            })
          } catch (error) {
            if (params.signal?.aborted) throw error
          }
          if (rendered && (rendered.isJson || unusableReason(rendered) === undefined)) {
            const links = pageLinks(rendered.html, parsedUrl)
            deps.log?.({
              event: "page-retrieval-attempt", url: params.url,
              domain: parsedUrl.hostname, method, outcome: "success",
              latencyMs: roundedLatency(now, startedAt),
            })
            return {
              url: params.url,
              content: rendered.content,
              links,
              retrievalMethod: method,
            }
          }
          const result = await deps.withBrowserPage({
            url: parsedUrl.href,
            signal: params.signal,
            timeoutMs: config.extraction.browserAgent.timeoutMs,
            prepare: recovery.prepare,
            run: async (page, signal) => {
              // Redirect aliases keep the selected source identity, as with direct
              // fetching. Recovery may not replace it with another document.
              const sourceUrl = validateUrl(page.url())
              const decode = async (html: string) => {
                const body = new TextEncoder().encode(html)
                if (body.byteLength > config.extraction.maxResponseBytes) {
                  throw new Error("Rendered page exceeded the response size limit")
                }
                return extractContent({
                  body,
                  contentType: "text/html",
                  pdfExtractor,
                  signal,
                  url: sourceUrl,
                })
              }
              let extracted = await decode(await readBrowserPageHtml(page, config.extraction.maxResponseBytes))
              let extraLinks: WebExtractResult["links"] = []
              if (unusableReason(extracted) !== undefined) {
                const recovered = await recovery.recover(page, signal)
                attemptObservedLinks = normalizeObservedLinks(
                  recovered.links,
                  sourceUrl,
                )
                observedRecoveryStatus = safeRecoveryStatus(recovered.status)
                if (recovered.status !== "extracted" || !recovered.html) {
                  const recoveryReason = safeRecoveryReason(recovered.reason)
                  const reason = recoveryReason ? ` (${recoveryReason})` : ""
                  throw new WebExtractionError(
                    `Browser recovery did not return usable source content${reason}`,
                    {
                      observedLinks: attemptObservedLinks,
                      recoveryReason,
                      recoveryStatus: observedRecoveryStatus,
                    },
                  )
                }
                extracted = await decode(recovered.html)
                extraLinks = attemptObservedLinks
              }
              if (canonicalUrl(page.url()) !== canonicalUrl(sourceUrl.href)) {
                attemptObservedLinks = []
                throw new WebExtractionError(
                  "Browser recovery left the selected source document",
                )
              }
              const failure = unusableReason(extracted)
              if (failure) {
                throw new WebExtractionError(failure, {
                  observedLinks: attemptObservedLinks,
                })
              }
              const links = normalizeWebSearchResults([
                ...pageLinks(extracted.html, sourceUrl),
                ...extraLinks,
              ].map(({ url, title }) => ({ link: url, title, shortText: title })))
                .map(({ link, title }) => ({ url: link, title }))
              return { url: params.url, content: extracted.content, links, retrievalMethod: method }
            },
          })
          deps.log?.({
            event: "page-retrieval-attempt", url: params.url,
            domain: parsedUrl.hostname, method, outcome: "success",
            latencyMs: roundedLatency(now, startedAt),
          })
          return result
        }
        const page = await deps.client.fetchPage({
          url: parsedUrl.href,
          mode,
          signal: params.signal,
        })
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
        }
      } catch (error) {
        const providerError =
          error instanceof PageFetchRequestError ? error : undefined
        let recoveryReason: string | undefined
        let recoveryStatus: string | undefined
        if (error instanceof WebExtractionError) {
          attemptObservedLinks = error.observedLinks
          recoveryReason = error.recoveryReason
          recoveryStatus = error.recoveryStatus
        }
        if (attemptObservedLinks.length > 0) observedLinks = attemptObservedLinks
        if (recoveryReason) observedRecoveryReason = recoveryReason
        if (recoveryStatus) observedRecoveryStatus = recoveryStatus
        deps.log?.({
          event: "page-retrieval-attempt",
          url: params.url,
          domain: parsedUrl.hostname,
          method,
          outcome: "failure",
          latencyMs: roundedLatency(now, startedAt),
          providerStatusCode: providerError?.providerStatusCode,
          failure: errorMessage(error),
        })
        if (params.signal?.aborted) {
          throw new WebExtractionError(
            errorMessage(error),
            { cause: error, observedLinks: attemptObservedLinks, recoveryReason, recoveryStatus },
          )
        }
      }
    }

    throw new WebExtractionError(
      `No retrieval method returned usable content for ${params.url}${observedRecoveryStatus || observedRecoveryReason ? ` (${[observedRecoveryStatus, observedRecoveryReason].filter(Boolean).join("/")})` : ""}`,
      { observedLinks, recoveryReason: observedRecoveryReason, recoveryStatus: observedRecoveryStatus },
    )
  }
}

const pageFetchClient = createPageFetchClient({
  browserlessUrl: config.extraction.browserless.url,
  browserlessToken: config.extraction.browserless.token,
  queueWaitTimeoutMs: config.extraction.queueWaitTimeoutMs,
  requestTimeoutMs: config.extraction.requestTimeoutMs,
  maxResponseBytes: config.extraction.maxResponseBytes,
})

const pdfExtractor = new PdfExtractor({
  maxBytes: config.extraction.maxResponseBytes,
  parseTimeoutMs: config.extraction.requestTimeoutMs,
})

export const webExtract = createWebExtractor({
  client: pageFetchClient,
  withBrowserPage: pageFetchClient.withBrowserPage,
  pdfExtractor,
})
