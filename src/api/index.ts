import { Hono } from "hono"
import { ping } from "./routes/ping.ts"
import { debug } from "./routes/debug.ts"
import { chat } from "./routes/chat.ts"

const app = new Hono()
const api = app.basePath("/api")

ping(api)
debug(api)
chat(api)

export { app }
