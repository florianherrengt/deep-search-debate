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

recoverInterruptedWork()

const app = new Hono()
const api = app.basePath("/api")

ping(api)
debug(api)
streams(api)
const deepSearchManager = createDeepSearchJobManager()
const ideaJobManager = createIdeaJobManager(deepSearchManager)
const debateJobManager = createDebateJobManager(ideaJobManager)
deepSearchJobs(api, deepSearchManager)
ideaJobs(api, ideaJobManager)
debateJobs(api, debateJobManager)

export { app }
