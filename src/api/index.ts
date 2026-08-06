import { Hono } from "hono"
import { ping } from "./routes/ping.ts"
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

export { app }
