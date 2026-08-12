import { and, eq } from "drizzle-orm"
import type { Handler, Hono } from "hono"

import { db } from "./db/index.ts"
import { debateJobs, ideaJobs } from "./db/schema/index.ts"
import { debateJobParamsSchema } from "./routes/debates/schemas.ts"
import type { AppEnv } from "./types/auth.ts"

const metadataStartMarker = "<!-- page-metadata:start -->"
const metadataEndMarker = "<!-- page-metadata:end -->"
const siteName = "RethinkLoop"
const socialImagePath = "/og-image.png"
const socialImageWidth = 1536
const socialImageHeight = 1024
const maxDescriptionLength = 200

type PublicDebatePreview = {
  prompt: string
  slug: string
  status: "running" | "completed" | "failed" | "interrupted"
  title: string
}

type PageMetadata = {
  description: string
  imageUrl: string
  title: string
  url: string
}

type PublicDebatePageOptions = {
  indexHtml: string
  publicBaseUrl: string
}

function normalizeWhitespace(value: string): string {
  return value.replace(/\s+/g, " ").trim()
}

function truncateAtWord(value: string, maxLength: number): string {
  if (value.length <= maxLength) return value

  // TODO: Truncate by Unicode code point so the boundary cannot split an emoji.
  const candidate = value.slice(0, maxLength - 1).trimEnd()
  const lastSpace = candidate.lastIndexOf(" ")
  const truncated =
    lastSpace >= Math.floor(maxLength * 0.75)
      ? candidate.slice(0, lastSpace)
      : candidate
  return `${truncated}…`
}

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;")
}

function getPublicDebatePreview(slug: string): PublicDebatePreview | undefined {
  return db
    .select({
      prompt: ideaJobs.prompt,
      slug: ideaJobs.slug,
      status: debateJobs.status,
      title: ideaJobs.title,
    })
    .from(debateJobs)
    .innerJoin(ideaJobs, eq(debateJobs.debateJobId, ideaJobs.debateJobId))
    .where(and(eq(ideaJobs.slug, slug), eq(debateJobs.isPublic, true)))
    .get()
}

function buildPageMetadata(
  debate: PublicDebatePreview,
  publicBaseUrl: string,
): PageMetadata {
  const prompt = normalizeWhitespace(debate.prompt)
  const descriptionPrefix =
    debate.status === "completed"
      ? "See which researched idea won this AI debate: "
      : debate.status === "running"
        ? "Follow AI agents as they research and debate: "
        : "Explore an AI research and debate tournament about: "

  return {
    title: `${normalizeWhitespace(debate.title)} — ${siteName}`,
    description: truncateAtWord(
      `${descriptionPrefix}${prompt}`,
      maxDescriptionLength,
    ),
    url: new URL(
      `/debates/${encodeURIComponent(debate.slug)}`,
      publicBaseUrl,
    ).href,
    imageUrl: new URL(socialImagePath, publicBaseUrl).href,
  }
}

function renderMetadataBlock(metadata: PageMetadata): string {
  const title = escapeHtml(metadata.title)
  const description = escapeHtml(metadata.description)
  const url = escapeHtml(metadata.url)
  const imageUrl = escapeHtml(metadata.imageUrl)

  return `${metadataStartMarker}
    <link rel="canonical" href="${url}" />
    <meta name="description" content="${description}" />
    <meta property="og:site_name" content="${siteName}" />
    <meta property="og:type" content="article" />
    <meta property="og:title" content="${title}" />
    <meta property="og:description" content="${description}" />
    <meta property="og:url" content="${url}" />
    <meta property="og:image" content="${imageUrl}" />
    <meta property="og:image:secure_url" content="${imageUrl}" />
    <meta property="og:image:type" content="image/png" />
    <meta property="og:image:width" content="${socialImageWidth}" />
    <meta property="og:image:height" content="${socialImageHeight}" />
    <meta property="og:image:alt" content="RethinkLoop debate logo" />
    <meta property="og:locale" content="en_GB" />
    <meta name="twitter:card" content="summary_large_image" />
    <meta name="twitter:title" content="${title}" />
    <meta name="twitter:description" content="${description}" />
    <meta name="twitter:image" content="${imageUrl}" />
    <meta name="twitter:image:alt" content="RethinkLoop debate logo" />
    <title>${title}</title>
    ${metadataEndMarker}`
}

function renderPublicDebateHtml(
  indexHtml: string,
  metadata: PageMetadata,
): string {
  const start = indexHtml.indexOf(metadataStartMarker)
  const end = indexHtml.indexOf(metadataEndMarker, start)
  if (start === -1 || end === -1) {
    throw new Error("The web index is missing its page metadata markers")
  }

  return `${indexHtml.slice(0, start)}${renderMetadataBlock(metadata)}${indexHtml.slice(end + metadataEndMarker.length)}`
}

/** Serves crawler-readable metadata without exposing private debate content. */
export function registerPublicDebatePage(
  app: Hono<AppEnv>,
  options: PublicDebatePageOptions,
): void {
  const serveDebatePage: Handler<AppEnv> = (c) => {
    const parsedParams = debateJobParamsSchema.safeParse(c.req.param())
    const debate = parsedParams.success
      ? getPublicDebatePreview(parsedParams.data.slug)
      : undefined
    const html = debate
      ? renderPublicDebateHtml(
          options.indexHtml,
          buildPageMetadata(debate, options.publicBaseUrl),
        )
      : options.indexHtml

    c.header("Cache-Control", "no-store")
    return c.html(html)
  }

  app.get("/debates/:slug", serveDebatePage)
  app.get("/debates/:slug/", serveDebatePage)
}
