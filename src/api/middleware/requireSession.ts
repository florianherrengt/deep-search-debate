import type { MiddlewareHandler } from "hono"

import { auth } from "../auth.ts"
import { config } from "../config.ts"
import type { AppEnv } from "../types/auth.ts"

export const requireSession: MiddlewareHandler<AppEnv> = async (c, next) => {
  const session = await auth.api.getSession({ headers: c.req.raw.headers })
  if (session === null) {
    return c.json({ error: "Unauthorized" }, 401)
  }
  c.set(
    "isDebugUser",
    config.auth.debugUser.enabled &&
      session.user.email === config.auth.debugUser.email,
  )
  c.set("userId", session.user.id)
  await next()
}
