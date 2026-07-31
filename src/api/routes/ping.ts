import type { Hono } from "hono"
import { z } from "zod"

export const PingResponse = z.object({
  message: z.string(),
})

export function ping(app: Hono) {
  app.get("/ping", (c) => {
    return c.json(PingResponse.parse({ message: "pong" }))
  })
}
