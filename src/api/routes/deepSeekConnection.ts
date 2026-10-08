import { zValidator } from "@hono/zod-validator"
import type { Hono } from "hono"
import z from "zod"

import {
  deleteDeepSeekApiKey,
  hasDeepSeekApiKey,
  setDeepSeekApiKey,
} from "../deepseekConnection/keysRepository.ts"
import type { AppEnv } from "../types/auth.ts"

const setApiKeySchema = z.object({
  apiKey: z.string().refine((value) => value.trim().length > 0, {
    message: "API key must not be empty",
  }),
}).strict()

export function deepSeekConnectionRoutes(app: Hono<AppEnv>): void {
  app.get("/deepseek-connection", (c) =>
    c.json({ hasKey: hasDeepSeekApiKey(c.get("userId")) }),
  )

  app.put(
    "/deepseek-connection",
    zValidator("json", setApiKeySchema),
    (c) => {
      setDeepSeekApiKey(c.get("userId"), c.req.valid("json").apiKey)
      return c.json({ hasKey: true })
    },
  )

  app.delete("/deepseek-connection", (c) => {
    deleteDeepSeekApiKey(c.get("userId"))
    return c.json({ hasKey: false })
  })
}
