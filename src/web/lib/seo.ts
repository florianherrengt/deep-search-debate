import { useEffect } from "react"

/** Canonical production origin used for canonical URLs and share metadata. */
export const SITE_URL = "https://rethinkloop.com"

export interface SeoOptions {
  title: string
  description?: string
  /** Site-relative path, e.g. "/debates/is-nuclear-power-worth-it". */
  path?: string
  /** Identifies the browser route that owns these tags, including private pages. */
  pageKey?: string
  noindex?: boolean
  openGraphType?: "article" | "website"
  jsonLd?: Record<string, unknown>
  /** Keeps matching crawler-visible server metadata intact while client data loads. */
  enabled?: boolean
}

/**
 * Creates, updates, or removes a single head element identified by selector,
 * applying `setContent` when the element exists or is freshly created.
 */
function upsertHeadElement(
  selector: string,
  create: () => HTMLElement,
  content: string | null,
  setContent: (element: HTMLElement, content: string) => void,
): void {
  const element = document.head.querySelector<HTMLElement>(selector)
  if (content === null) {
    element?.remove()
    return
  }
  if (element === null) {
    const created = create()
    document.head.appendChild(created)
    setContent(created, content)
    return
  }
  setContent(element, content)
}

function upsertMeta(
  attribute: "name" | "property",
  key: string,
  content: string | null,
): void {
  upsertHeadElement(
    `meta[${attribute}="${key}"]`,
    () => {
      const element = document.createElement("meta")
      element.setAttribute(attribute, key)
      return element
    },
    content,
    (element, text) => element.setAttribute("content", text),
  )
}

function applySeo(
  title: string,
  description: string | undefined,
  path: string | undefined,
  pageKey: string | undefined,
  noindex: boolean,
  openGraphType: "article" | "website",
  jsonLdSource: string | undefined,
): void {
  const canonicalUrl =
    path === undefined ? null : new URL(path, `${SITE_URL}/`).href

  document.title = title
  upsertMeta("name", "description", description ?? null)
  upsertMeta("name", "robots", noindex ? "noindex, nofollow" : "index, follow")
  upsertMeta("property", "og:title", title)
  upsertMeta("property", "og:description", description ?? null)
  upsertMeta("property", "og:type", openGraphType)
  upsertMeta("property", "og:url", canonicalUrl)
  upsertMeta("name", "twitter:title", title)
  upsertMeta("name", "twitter:description", description ?? null)

  upsertHeadElement(
    'link[rel="canonical"]',
    () => document.createElement("link"),
    canonicalUrl,
    (element, href) => {
      element.setAttribute("rel", "canonical")
      element.setAttribute("href", href)
    },
  )

  upsertHeadElement(
    'script[data-seo-json-ld="true"]',
    () => {
      const script = document.createElement("script")
      script.type = "application/ld+json"
      script.dataset.seoJsonLd = "true"
      return script
    },
    jsonLdSource ?? null,
    (element, source) => {
      element.textContent = source
    },
  )

  if (pageKey === undefined) {
    delete document.documentElement.dataset.seoPage
  } else {
    document.documentElement.dataset.seoPage = pageKey
  }
}

/**
 * Mirrors server-rendered search and share metadata after SPA navigation.
 * Direct requests receive the same route-specific tags in the initial HTML.
 */
export function useSeo(options: SeoOptions): void {
  const {
    title,
    description,
    path,
    pageKey,
    noindex = false,
    openGraphType = "website",
    jsonLd,
    enabled = true,
  } = options
  const jsonLdSource =
    jsonLd === undefined ? undefined : JSON.stringify(jsonLd)

  useEffect(() => {
    if (
      !enabled &&
      pageKey !== undefined &&
      document.documentElement.dataset.seoPage === pageKey
    ) {
      return
    }
    applySeo(
      title,
      description,
      path,
      pageKey,
      noindex,
      openGraphType,
      jsonLdSource,
    )
  }, [
    title,
    description,
    path,
    pageKey,
    noindex,
    openGraphType,
    jsonLdSource,
    enabled,
  ])
}

/** Truncates free-text content to a meta-description-length summary. */
export function truncateDescription(text: string, maxLength = 160): string {
  const normalized = text.replace(/\s+/g, " ").trim()
  if (normalized.length <= maxLength) return normalized
  return `${normalized.slice(0, maxLength).replace(/\s+\S*$/, "")}…`
}
