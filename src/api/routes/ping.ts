import type { Hono } from "hono"
import { z } from "zod"
import type { AppEnv } from "../types/auth.ts"

export const pingResponseSchema = z.object({
  message: z.string(),
})

export function ping(app: Hono<AppEnv>) {
  app.get("/ping", (c) => {
    return c.json({ message: "pong" })
  })
}
