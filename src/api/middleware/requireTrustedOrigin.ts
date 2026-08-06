import type { MiddlewareHandler } from "hono"

import { config } from "../config.ts"
import type { AppEnv } from "../types/auth.ts"

const safeMethods = new Set(["GET", "HEAD", "OPTIONS"])

/** Rejects browser cross-site mutations while still allowing non-browser API clients. */
export const requireTrustedOrigin: MiddlewareHandler<AppEnv> = async (
  c,
  next,
) => {
  if (safeMethods.has(c.req.method)) {
    await next()
    return
  }

  const origin = c.req.header("origin")
  const fetchSite = c.req.header("sec-fetch-site")
  if (
    (origin !== undefined && origin !== config.auth.trustedOrigin) ||
    (origin === undefined && fetchSite === "cross-site")
  ) {
    return c.json({ error: "Forbidden" }, 403)
  }

  await next()
}
