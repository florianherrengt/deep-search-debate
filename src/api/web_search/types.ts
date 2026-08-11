import z from "zod"
import {
  normalizeUrl,
  validateUrl,
} from "deep-search-core/search-extract"

export const MAX_WEB_SEARCH_RESULTS = 30
export const MAX_WEB_SEARCH_TITLE_CHARS = 500
export const MAX_WEB_SEARCH_SNIPPET_CHARS = 4_000
const MAX_WEB_SEARCH_URL_CHARS = 2_048

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
      link = normalizeUrl(validateUrl(result.link).href)
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
