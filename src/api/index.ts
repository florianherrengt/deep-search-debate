import { Hono } from "hono"
import { serveStatic } from "@hono/node-server/serve-static"
import { fileURLToPath } from "node:url"
import { ping } from "./routes/ping.ts"
import { health } from "./routes/health.ts"
import { debug } from "./routes/debug.ts"
import { streams } from "./routes/streams.ts"
import { deepSearchJobs } from "./routes/deepSearch/index.ts"
import { createDeepSearchJobManager } from "./routes/deepSearch/manager.ts"
import { ideaJobs } from "./routes/ideas/index.ts"
import { createIdeaJobManager } from "./routes/ideas/manager.ts"
import { debateJobs } from "./routes/debates/index.ts"
import { createDebateJobManager } from "./routes/debates/manager.ts"
import { recoverInterruptedWork } from "./db/recovery.ts"
import { authRoutes } from "./routes/auth.ts"
import { requireSession } from "./middleware/requireSession.ts"
import type { AppEnv } from "./types/auth.ts"
import { requireTrustedOrigin } from "./middleware/requireTrustedOrigin.ts"
import { config } from "./config.ts"

recoverInterruptedWork()

const app = new Hono<AppEnv>()
const api = app.basePath("/api")

ping(api)
health(api)
authRoutes(api)
api.use("*", requireTrustedOrigin)
api.use("*", requireSession)
if (config.auth.debugUser.enabled) debug(api)
streams(api)
const deepSearchManager = createDeepSearchJobManager()
const ideaJobManager = createIdeaJobManager(deepSearchManager)
const debateJobManager = createDebateJobManager(ideaJobManager)
deepSearchJobs(api, deepSearchManager)
ideaJobs(api, ideaJobManager)
debateJobs(api, debateJobManager)

if (config.environment === "production") {
  const webRoot = fileURLToPath(new URL("../web/dist", import.meta.url))
  const serveWebIndex = serveStatic({ path: "index.html", root: webRoot })

  app.get("*", serveStatic({ root: webRoot }))
  app.get("*", (c, next) => {
    if (c.req.path === "/api" || c.req.path.startsWith("/api/")) return next()
    return serveWebIndex(c, next)
  })
}

export { app }
