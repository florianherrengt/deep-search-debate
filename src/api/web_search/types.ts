import z from "zod"
import { validateUrl } from "deep-search-core/search-extract/core"

export const MAX_WEB_SEARCH_RESULTS = 30
export const MAX_WEB_SEARCH_TITLE_CHARS = 500
export const MAX_WEB_SEARCH_SNIPPET_CHARS = 4_000
const MAX_WEB_SEARCH_URL_CHARS = 2_048
const trackingParameters = new Set([
  "utm_source",
  "utm_medium",
  "utm_campaign",
  "utm_term",
  "utm_content",
  "fbclid",
  "gclid",
  "gclsrc",
  "dclid",
  "msclkid",
  "mc_eid",
])

function canonicalUrl(rawUrl: string): string {
  const url = validateUrl(rawUrl)
  url.hostname = url.hostname.toLowerCase()
  url.username = ""
  url.password = ""
  url.hash = ""
  for (const key of [...url.searchParams.keys()]) {
    if (trackingParameters.has(key.toLowerCase())) url.searchParams.delete(key)
  }
  if (url.pathname.length > 1 && url.pathname.endsWith("/")) {
    url.pathname = url.pathname.slice(0, -1)
  }
  return url.toString()
}

const webSearchResultsSchema = z.array(
  z.object({
    title: z.string().trim().min(1).max(MAX_WEB_SEARCH_TITLE_CHARS),
    shortText: z.string().trim().min(1).max(MAX_WEB_SEARCH_SNIPPET_CHARS),
    link: z.url().max(MAX_WEB_SEARCH_URL_CHARS),
  }),
).max(MAX_WEB_SEARCH_RESULTS)

export type WebSearchResult = z.infer<typeof webSearchResultsSchema>[number]

type ProviderSearchResult = {
  title: string
  shortText: string
  link: string
}

/** Produces the one bounded, extractable URL contract persisted by the app. */
export function normalizeWebSearchResults(
  results: ProviderSearchResult[],
): WebSearchResult[] {
  const normalized: ProviderSearchResult[] = []
  const seenUrls = new Set<string>()

  for (const result of results) {
    const title = result.title.trim().slice(0, MAX_WEB_SEARCH_TITLE_CHARS)
    const shortText = result.shortText
      .trim()
      .slice(0, MAX_WEB_SEARCH_SNIPPET_CHARS)
    if (!title || !shortText) continue

    let link: string
    try {
      link = canonicalUrl(result.link)
      validateUrl(link)
    } catch {
      continue
    }
    if (link.length > MAX_WEB_SEARCH_URL_CHARS || seenUrls.has(link)) continue

    seenUrls.add(link)
    normalized.push({ title, shortText, link })
    if (normalized.length === MAX_WEB_SEARCH_RESULTS) break
  }

  return webSearchResultsSchema.parse(normalized)
}
