import "dotenv/config"
import { serve } from "@hono/node-server"
import { config } from "./config.ts"
import { app } from "./index.ts"

serve({ fetch: app.fetch, port: config.api.port }, (info) => {
  console.log(`Listening on http://localhost:${info.port}`)
})
