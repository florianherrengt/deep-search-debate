import { Hono } from "hono"
import { ping } from "./routes/ping.ts"
import { debug } from "./routes/debug.ts"
import { streams } from "./routes/streams.ts"
import { deepSearchJobs } from "./routes/deepSearch/index.ts"
import { recoverInterruptedWork } from "./db/recovery.ts"

recoverInterruptedWork()

const app = new Hono()
const api = app.basePath("/api")

ping(api)
debug(api)
streams(api)
deepSearchJobs(api)

export { app }
