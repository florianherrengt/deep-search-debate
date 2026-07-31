import type { Hono } from "hono"
import { z } from "zod"

export const pingResponseSchema = z.object({
  message: z.string(),
})

export function ping(app: Hono) {
  app.get("/ping", (c) => {
    return c.json(pingResponseSchema.parse({ message: "pong" }))
  })
}
