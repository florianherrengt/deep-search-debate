import { and, eq, inArray } from "drizzle-orm"
import type { Hono } from "hono"

import { config } from "../config.ts"
import { db } from "../db/index.ts"
import {
  debateJobs as debateJobsTable,
  deepSearchJobs as deepSearchJobsTable,
  ideaJobs as ideaJobsTable,
  ideas as ideasTable,
} from "../db/schema/index.ts"
import type { AppEnv } from "../types/auth.ts"

const HOME_DESCRIPTION =
  "Give AI agents a problem. They generate multiple researched ideas and debate them through multiple rounds until one winner remains."
const EXAMPLES_DESCRIPTION =
  "Explore selected RethinkLoop examples with researched ideas, multi-round AI debates, and a final winner."
const privatePageLabels: Readonly<Record<string, string>> = {
  "/about": "About",
  "/admin/credits": "Admin Credits",
  "/debates": "Debates",
  "/deep-search": "Deep Search",
  "/ideas": "Ideas",
}

export interface SeoMetadata {
  canonicalUrl: string | null
  description: string
  jsonLd?: Record<string, unknown>
  noindex: boolean
  openGraphType: "article" | "website"
  title: string
}

export type SeoPageResult =
  | { kind: "not-found" }
  | { kind: "page"; metadata: SeoMetadata }

function escapeXml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&apos;")
}

function canonicalUrl(path: string): string {
  return new URL(path, config.auth.baseUrl).href
}

function resourcePath(kind: string, ...segments: string[]): string {
  return `/${kind}/${segments.map((segment) => encodeURIComponent(segment)).join("/")}`
}

function publicDebateSlugs(debateJobIds: readonly string[]): string[] {
  if (debateJobIds.length === 0) return []
  return db
    .select({ slug: ideaJobsTable.slug })
    .from(debateJobsTable)
    .innerJoin(
      ideaJobsTable,
      eq(debateJobsTable.debateJobId, ideaJobsTable.debateJobId),
    )
    .where(
      and(
        inArray(debateJobsTable.debateJobId, [...debateJobIds]),
        eq(debateJobsTable.isPublic, true),
        eq(debateJobsTable.status, "completed"),
      ),
    )
    .all()
    .map((row) => row.slug)
}

function publicDeepSearchSlugs(debateJobIds: readonly string[]): string[] {
  if (debateJobIds.length === 0) return []
  return db
    .select({ slug: deepSearchJobsTable.slug })
    .from(deepSearchJobsTable)
    .innerJoin(
      ideaJobsTable,
      eq(ideaJobsTable.ideaJobId, deepSearchJobsTable.ideaJobId),
    )
    .innerJoin(
      debateJobsTable,
      eq(debateJobsTable.debateJobId, ideaJobsTable.debateJobId),
    )
    .where(
      and(
        inArray(debateJobsTable.debateJobId, [...debateJobIds]),
        eq(debateJobsTable.isPublic, true),
        eq(debateJobsTable.status, "completed"),
      ),
    )
    .all()
    .map((row) => row.slug)
}

function publicIdeas(
  debateJobIds: readonly string[],
): { ideaId: string; slug: string }[] {
  if (debateJobIds.length === 0) return []
  return db
    .select({ ideaId: ideasTable.ideaId, slug: ideaJobsTable.slug })
    .from(ideasTable)
    .innerJoin(
      ideaJobsTable,
      eq(ideaJobsTable.ideaJobId, ideasTable.ideaJobId),
    )
    .innerJoin(
      debateJobsTable,
      eq(debateJobsTable.debateJobId, ideaJobsTable.debateJobId),
    )
    .where(
      and(
        inArray(debateJobsTable.debateJobId, [...debateJobIds]),
        eq(debateJobsTable.isPublic, true),
        eq(debateJobsTable.status, "completed"),
      ),
    )
    .all()
}

function sitemapXml(debateJobIds: readonly string[]): string {
  // One sitemap is intentional at the current scale. Split this into a sitemap
  // index before it approaches 50,000 URLs or 50 MB uncompressed.
  const paths = new Set<string>(["/", "/examples"])
  for (const slug of publicDebateSlugs(debateJobIds)) {
    paths.add(resourcePath("debates", slug))
    paths.add(resourcePath("ideas", slug))
  }
  for (const slug of publicDeepSearchSlugs(debateJobIds)) {
    paths.add(resourcePath("deep-search", slug))
  }
  for (const idea of publicIdeas(debateJobIds)) {
    paths.add(resourcePath("ideas", idea.slug, idea.ideaId))
  }

  const entries = [...paths]
    .map((path) => canonicalUrl(path))
    .sort()
    .map((url) => `<url><loc>${escapeXml(url)}</loc></url>`)
    .join("")

  return `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">${entries}</urlset>
`
}

function robotsTxt(): string {
  return `User-agent: *
Allow: /

Sitemap: ${canonicalUrl("/sitemap.xml")}
`
}

/** Registers crawler discovery endpoints outside the /api base path. */
export function seoPages(
  app: Hono<AppEnv>,
  debateJobIds: readonly string[] = config.examples.debateIds,
): void {
  app.get("/robots.txt", (c) =>
    c.text(robotsTxt(), 200, {
      "Content-Type": "text/plain; charset=utf-8",
    }),
  )
  app.get("/sitemap.xml", (c) =>
    c.text(sitemapXml(debateJobIds), 200, {
      "Content-Type": "application/xml; charset=utf-8",
    }),
  )
}

function decodeSegment(segment: string): string | null {
  try {
    const decoded = decodeURIComponent(segment)
    return decoded.length > 0 && !decoded.includes("/") ? decoded : null
  } catch {
    return null
  }
}

function truncateDescription(text: string, maxLength = 160): string {
  const normalized = text.replace(/\s+/g, " ").trim()
  if (normalized.length <= maxLength) return normalized
  return `${normalized.slice(0, maxLength).replace(/\s+\S*$/, "")}…`
}

function articleMetadata(options: {
  description: string
  indexable: boolean
  path: string
  public: boolean
  title: string
}): SeoMetadata {
  const title = `${options.title} — RethinkLoop`
  const description = truncateDescription(options.description)
  return {
    canonicalUrl: options.public ? canonicalUrl(options.path) : null,
    description,
    jsonLd: options.indexable
      ? {
          "@context": "https://schema.org",
          "@type": "Article",
          description,
          headline: options.title,
          inLanguage: "en",
          isAccessibleForFree: true,
        }
      : undefined,
    noindex: !options.indexable,
    openGraphType: "article",
    title,
  }
}

function resolveDebate(slug: string, viewerUserId: string | null): SeoPageResult {
  const row = db
    .select({
      isPublic: debateJobsTable.isPublic,
      prompt: ideaJobsTable.prompt,
      status: debateJobsTable.status,
      title: ideaJobsTable.title,
      userId: debateJobsTable.userId,
    })
    .from(debateJobsTable)
    .innerJoin(
      ideaJobsTable,
      eq(debateJobsTable.debateJobId, ideaJobsTable.debateJobId),
    )
    .where(eq(ideaJobsTable.slug, slug))
    .get()

  if (row === undefined || (!row.isPublic && row.userId !== viewerUserId)) {
    return { kind: "not-found" }
  }
  return {
    kind: "page",
    metadata: articleMetadata({
      description: row.prompt,
      indexable: row.isPublic && row.status === "completed",
      path: resourcePath("debates", slug),
      public: row.isPublic,
      title: row.title,
    }),
  }
}

function findIdeaJob(slug: string) {
  return db
    .select({
      debateIsPublic: debateJobsTable.isPublic,
      debateStatus: debateJobsTable.status,
      ideaJobId: ideaJobsTable.ideaJobId,
      prompt: ideaJobsTable.prompt,
      title: ideaJobsTable.title,
      userId: ideaJobsTable.userId,
    })
    .from(ideaJobsTable)
    .leftJoin(
      debateJobsTable,
      eq(debateJobsTable.debateJobId, ideaJobsTable.debateJobId),
    )
    .where(eq(ideaJobsTable.slug, slug))
    .get()
}

function canReadInheritedResource(
  row: { debateIsPublic: boolean | null; userId: string },
  viewerUserId: string | null,
): boolean {
  return row.debateIsPublic === true || row.userId === viewerUserId
}

function resolveIdeaJob(
  slug: string,
  viewerUserId: string | null,
): SeoPageResult {
  const row = findIdeaJob(slug)
  if (row === undefined || !canReadInheritedResource(row, viewerUserId)) {
    return { kind: "not-found" }
  }
  const isPublic = row.debateIsPublic === true
  return {
    kind: "page",
    metadata: articleMetadata({
      description: row.prompt,
      indexable: isPublic && row.debateStatus === "completed",
      path: resourcePath("ideas", slug),
      public: isPublic,
      title: row.title,
    }),
  }
}

function resolveIdea(
  slug: string,
  ideaId: string,
  viewerUserId: string | null,
): SeoPageResult {
  const job = findIdeaJob(slug)
  if (job === undefined || !canReadInheritedResource(job, viewerUserId)) {
    return { kind: "not-found" }
  }
  const idea = db
    .select({
      description: ideasTable.description,
      refinedDescription: ideasTable.refinedDescription,
      refinedTitle: ideasTable.refinedTitle,
      title: ideasTable.title,
    })
    .from(ideasTable)
    .where(
      and(
        eq(ideasTable.ideaJobId, job.ideaJobId),
        eq(ideasTable.ideaId, ideaId),
      ),
    )
    .get()
  if (idea === undefined) return { kind: "not-found" }

  const isPublic = job.debateIsPublic === true
  return {
    kind: "page",
    metadata: articleMetadata({
      description: idea.refinedDescription ?? idea.description,
      indexable: isPublic && job.debateStatus === "completed",
      path: resourcePath("ideas", slug, ideaId),
      public: isPublic,
      title: idea.refinedTitle ?? idea.title,
    }),
  }
}

function resolveDeepSearch(
  slug: string,
  viewerUserId: string | null,
): SeoPageResult {
  const row = db
    .select({
      debateIsPublic: debateJobsTable.isPublic,
      debateStatus: debateJobsTable.status,
      researchRequest: deepSearchJobsTable.researchRequest,
      title: deepSearchJobsTable.title,
      userId: deepSearchJobsTable.userId,
    })
    .from(deepSearchJobsTable)
    .leftJoin(
      ideaJobsTable,
      eq(ideaJobsTable.ideaJobId, deepSearchJobsTable.ideaJobId),
    )
    .leftJoin(
      debateJobsTable,
      eq(debateJobsTable.debateJobId, ideaJobsTable.debateJobId),
    )
    .where(eq(deepSearchJobsTable.slug, slug))
    .get()

  if (row === undefined || !canReadInheritedResource(row, viewerUserId)) {
    return { kind: "not-found" }
  }
  const isPublic = row.debateIsPublic === true
  return {
    kind: "page",
    metadata: articleMetadata({
      description: row.researchRequest,
      indexable: isPublic && row.debateStatus === "completed",
      path: resourcePath("deep-search", slug),
      public: isPublic,
      title: row.title,
    }),
  }
}

/** Resolves an application route using the same visibility facts as API reads. */
export function resolveSeoPage(
  path: string,
  viewerUserId: string | null,
): SeoPageResult {
  const normalizedPath = path === "/" ? path : path.replace(/\/+$/, "")
  if (normalizedPath === "/") {
    return {
      kind: "page",
      metadata: {
        canonicalUrl: canonicalUrl("/"),
        description: HOME_DESCRIPTION,
        noindex: false,
        openGraphType: "website",
        title: "RethinkLoop — AI idea tournaments",
      },
    }
  }

  if (normalizedPath === "/examples") {
    return {
      kind: "page",
      metadata: {
        canonicalUrl: canonicalUrl("/examples"),
        description: EXAMPLES_DESCRIPTION,
        noindex: false,
        openGraphType: "website",
        title: "Examples — RethinkLoop",
      },
    }
  }

  if (normalizedPath === "/terms" || normalizedPath === "/privacy") {
    const title =
      normalizedPath === "/terms" ? "Terms & Conditions" : "Privacy Policy"
    return {
      kind: "page",
      metadata: {
        canonicalUrl: null,
        description: `${title} for RethinkLoop, a research and decision workspace for questions that need more than one model response.`,
        noindex: true,
        openGraphType: "website",
        title: `${title} — RethinkLoop`,
      },
    }
  }

  const privatePageLabel = privatePageLabels[normalizedPath]
  if (privatePageLabel !== undefined) {
    return {
      kind: "page",
      metadata: {
        canonicalUrl: null,
        description: `${privatePageLabel} in RethinkLoop. Sign in to access your workspace.`,
        noindex: true,
        openGraphType: "website",
        title: `${privatePageLabel} — RethinkLoop`,
      },
    }
  }

  const match = normalizedPath.match(
    /^\/(debates|deep-search|ideas)\/([^/]+)(?:\/([^/]+))?$/,
  )
  if (match === null) return { kind: "not-found" }
  const kind = match[1]
  const slug = decodeSegment(match[2])
  const nestedId = match[3] === undefined ? undefined : decodeSegment(match[3])
  if (slug === null || nestedId === null) return { kind: "not-found" }

  if (kind === "debates") {
    return nestedId === undefined
      ? resolveDebate(slug, viewerUserId)
      : { kind: "not-found" }
  }
  if (kind === "deep-search") {
    return nestedId === undefined
      ? resolveDeepSearch(slug, viewerUserId)
      : { kind: "not-found" }
  }
  return nestedId === undefined
    ? resolveIdeaJob(slug, viewerUserId)
    : resolveIdea(slug, nestedId, viewerUserId)
}

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;")
}

function replaceHeadElement(
  document: string,
  pattern: RegExp,
  replacement: string | null,
): string {
  if (pattern.test(document)) {
    return document.replace(pattern, replacement ?? "")
  }
  if (replacement === null) return document
  return document.replace("</head>", `  ${replacement}\n  </head>`)
}

function replaceMeta(
  document: string,
  attribute: "name" | "property",
  key: string,
  content: string | null,
): string {
  const pattern = new RegExp(
    `<meta\\b(?=[^>]*\\b${attribute}=["']${key}["'])[^>]*>`,
    "i",
  )
  const replacement =
    content === null
      ? null
      : `<meta ${attribute}="${key}" content="${escapeHtml(content)}" />`
  return replaceHeadElement(document, pattern, replacement)
}

/** Applies route metadata to the built SPA shell before it reaches a crawler. */
export function renderSeoDocument(
  template: string,
  metadata: SeoMetadata,
  pageKey?: string,
): string {
  let document =
    pageKey === undefined
      ? template
      : template.replace(
          /<html\b([^>]*)>/i,
          `<html$1 data-seo-page="${escapeHtml(pageKey)}">`,
        )
  document = replaceHeadElement(
    document,
    /<title\b[^>]*>[\s\S]*?<\/title>/i,
    `<title>${escapeHtml(metadata.title)}</title>`,
  )
  document = replaceMeta(
    document,
    "name",
    "robots",
    metadata.noindex ? "noindex, nofollow" : "index, follow",
  )
  document = replaceMeta(document, "name", "description", metadata.description)
  document = replaceMeta(document, "property", "og:type", metadata.openGraphType)
  document = replaceMeta(document, "property", "og:title", metadata.title)
  document = replaceMeta(
    document,
    "property",
    "og:description",
    metadata.description,
  )
  document = replaceMeta(document, "property", "og:url", metadata.canonicalUrl)
  document = replaceMeta(document, "name", "twitter:title", metadata.title)
  document = replaceMeta(
    document,
    "name",
    "twitter:description",
    metadata.description,
  )

  document = replaceHeadElement(
    document,
    /<link\b(?=[^>]*\brel=["']canonical["'])[^>]*>/i,
    metadata.canonicalUrl === null
      ? null
      : `<link rel="canonical" href="${escapeHtml(metadata.canonicalUrl)}" />`,
  )

  const jsonLd =
    metadata.jsonLd === undefined
      ? null
      : JSON.stringify(metadata.jsonLd)
          .replaceAll("&", "\\u0026")
          .replaceAll("<", "\\u003c")
          .replaceAll(">", "\\u003e")
  document = replaceHeadElement(
    document,
    /<script\b(?=[^>]*\bdata-seo-json-ld=["']true["'])[^>]*>[\s\S]*?<\/script>/i,
    jsonLd === null
      ? null
      : `<script type="application/ld+json" data-seo-json-ld="true">${jsonLd}</script>`,
  )
  return document
}

export const notFoundHtml = `<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <meta name="robots" content="noindex, nofollow" />
    <title>Page not found — RethinkLoop</title>
  </head>
  <body>
    <h1>Page not found</h1>
    <p>The page you requested does not exist or is no longer available.</p>
    <a href="/">Go home</a>
  </body>
</html>
`
