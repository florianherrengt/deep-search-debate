import type { MiddlewareHandler } from "hono"

import { auth } from "../auth.ts"
import { config } from "../config.ts"
import type { AppEnv } from "../types/auth.ts"

/** Loads a session when present without rejecting anonymous read requests. */
export const loadOptionalSession: MiddlewareHandler<AppEnv> = async (
  c,
  next,
) => {
  const session = await auth.api.getSession({ headers: c.req.raw.headers })
  c.set("viewerUserId", session?.user.id ?? null)
  c.set(
    "isDebugUser",
    session !== null &&
      config.auth.debugUser.enabled &&
      session.user.email === config.auth.debugUser.email,
  )
  await next()
}
