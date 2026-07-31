import { Hono } from "hono"
import { ping } from "./routes/ping.ts"
import { debug } from "./routes/debug.ts"
import { streams } from "./routes/streams.ts"

const app = new Hono()
const api = app.basePath("/api")

ping(api)
debug(api)
streams(api)

export { app }
