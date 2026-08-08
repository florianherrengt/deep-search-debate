import type { MiddlewareHandler } from "hono"

import type { AppEnv } from "../types/auth.ts"

export const requireSession: MiddlewareHandler<AppEnv> = async (c, next) => {
  const userId = c.get("viewerUserId")
  if (userId === null) {
    return c.json({ error: "Unauthorized" }, 401)
  }
  c.set("userId", userId)
  await next()
}
