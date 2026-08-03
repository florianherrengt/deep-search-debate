import "dotenv/config"
import { serve } from "@hono/node-server"
import { config } from "./config.ts"
import { app } from "./index.ts"

serve(
  {
    fetch: app.fetch,
    hostname: config.api.hostname,
    port: config.api.port,
  },
  (info) => {
    console.log(`Listening on http://${config.api.hostname}:${info.port}`)
  },
)
