import { Hono, type Context } from "hono"
import { HTTPException } from "hono/http-exception"
import { serveStatic } from "@hono/node-server/serve-static"
import { readFileSync } from "node:fs"
import { fileURLToPath } from "node:url"
import { ping } from "./routes/ping.ts"
import { health } from "./routes/health.ts"
import { debug } from "./routes/debug.ts"
import { streamReads, streams } from "./routes/streams.ts"
import {
  deepSearchJobReads,
  deepSearchJobs,
} from "./routes/deepSearch/index.ts"
import { createDeepSearchJobManager } from "./routes/deepSearch/manager.ts"
import { ideaJobReads, ideaJobs } from "./routes/ideas/index.ts"
import { createIdeaJobManager } from "./routes/ideas/manager.ts"
import { debateJobReads, debateJobs } from "./routes/debates/index.ts"
import { createDebateJobManager } from "./routes/debates/manager.ts"
import { recoverInterruptedWork } from "./db/recovery.ts"
import { authRoutes } from "./routes/auth.ts"
import { requireSession } from "./middleware/requireSession.ts"
import type { AppEnv } from "./types/auth.ts"
import { requireTrustedOrigin } from "./middleware/requireTrustedOrigin.ts"
import { config } from "./config.ts"
import { loadOptionalSession } from "./middleware/loadOptionalSession.ts"
import { creditRoutes } from "./routes/credits.ts"
import { OutOfCreditsError } from "./credits.ts"
import {
  notFoundHtml,
  renderSeoDocument,
  resolveSeoPage,
  seoPages,
} from "./routes/seo.ts"
import { exampleDebateReads } from "./routes/examples/index.ts"

recoverInterruptedWork()

export function handleRequestError(
  error: Error,
  context: Context<AppEnv>,
): Response {
  if (error instanceof HTTPException) {
    const response = error.getResponse()
    return context.newResponse(response.body, response)
  }
  if (error instanceof OutOfCreditsError) {
    return context.json(
      {
        error: "Insufficient credits",
        remainingCredits: error.remainingCredits,
      },
      402,
    )
  }

  // Provider errors can retain full prompts, response bodies, and every retry
  // attempt. Never pass the error object or its message to the process logger.
  console.error("Unhandled request error", {
    method: context.req.method,
    path: context.req.path,
    errorName: error.name,
  })
  return context.text("Internal Server Error", 500)
}

export function setWebAssetCacheHeaders(
  servedPath: string,
  context: Context<AppEnv>,
): void {
  if (servedPath.endsWith("index.html")) {
    context.header("Cache-Control", "private, no-store")
    context.header("Cloudflare-CDN-Cache-Control", "no-store")
    return
  }

  const isVersionedAsset = context.req.path.startsWith("/assets/")
  context.header(
    "Cache-Control",
    isVersionedAsset
      ? "public, max-age=31536000, immutable"
      : "public, max-age=3600",
  )
  context.header(
    "Cloudflare-CDN-Cache-Control",
    isVersionedAsset
      ? "public, max-age=31536000, immutable"
      : "public, max-age=86400",
  )
}

const app = new Hono<AppEnv>()
app.onError(handleRequestError)
const api = app.basePath("/api")

seoPages(app)
ping(api)
health(api)
authRoutes(api)
api.use("*", requireTrustedOrigin)
api.use("*", loadOptionalSession)
const deepSearchManager = createDeepSearchJobManager()
const ideaJobManager = createIdeaJobManager(deepSearchManager)
const debateJobManager = createDebateJobManager(ideaJobManager)
streamReads(api)
deepSearchJobReads(api, deepSearchManager)
ideaJobReads(api, ideaJobManager)
debateJobReads(api, debateJobManager)
exampleDebateReads(api)
api.use("*", requireSession)
creditRoutes(api)
if (config.auth.debugUser.enabled) debug(api)
streams(api)
deepSearchJobs(api, deepSearchManager)
ideaJobs(api, ideaJobManager)
debateJobs(api, debateJobManager)

if (config.environment === "production") {
  const webRoot = fileURLToPath(new URL("../web/dist", import.meta.url))
  const webIndex = readFileSync(`${webRoot}/index.html`, "utf8")
  app.get(
    "*",
    serveStatic({ root: webRoot, onFound: setWebAssetCacheHeaders }),
  )
  app.get("*", loadOptionalSession)
  app.get("*", (c, next) => {
    if (c.req.path === "/api" || c.req.path.startsWith("/api/")) {
      return next()
    }
    const requestPath = new URL(c.req.url).pathname
    const pageKey =
      requestPath === "/" ? requestPath : requestPath.replace(/\/+$/, "")
    const page = resolveSeoPage(c.req.path, c.get("viewerUserId"))
    if (page.kind === "not-found") {
      return Promise.resolve(
        c.html(notFoundHtml, 404, {
          "Cache-Control": "private, no-store",
          "X-Robots-Tag": "noindex, nofollow",
        }),
      )
    }
    return Promise.resolve(
      c.html(
        renderSeoDocument(
          webIndex,
          page.metadata,
          pageKey,
        ),
        200,
        {
          "Cache-Control": "private, no-store",
          ...(page.metadata.noindex
            ? { "X-Robots-Tag": "noindex, nofollow" }
            : {}),
        },
      ),
    )
  })
}

export { app }
