import { eq } from "drizzle-orm"
import type { Hono } from "hono"
import z from "zod"

import { auth } from "../auth.ts"
import { config } from "../config.ts"
import { db } from "../db/index.ts"
import { user } from "../db/schema/index.ts"
import type { AppEnv } from "../types/auth.ts"

export const authConfigResponseSchema = z.object({
  debugUserEnabled: z.boolean(),
})

function isTrustedDebugRequest(request: Request): boolean {
  return (
    request.headers.get("origin") === config.auth.trustedOrigin &&
    request.headers.get("x-debug-auth") === "1"
  )
}

async function signInDebugUser(request: Request): Promise<Response> {
  const password = config.auth.debugUser.password
  if (!config.auth.debugUser.enabled || password === undefined) {
    return Response.json({ error: "Not found" }, { status: 404 })
  }
  if (!isTrustedDebugRequest(request)) {
    return Response.json({ error: "Forbidden" }, { status: 403 })
  }

  const existingUser = db
    .select({ id: user.id })
    .from(user)
    .where(eq(user.email, config.auth.debugUser.email))
    .get()

  if (existingUser === undefined) {
    return auth.api.signUpEmail({
      asResponse: true,
      body: {
        email: config.auth.debugUser.email,
        name: "Debug User",
        password,
      },
      headers: request.headers,
    })
  }

  return auth.api.signInEmail({
    asResponse: true,
    body: {
      email: config.auth.debugUser.email,
      password,
    },
    headers: request.headers,
  })
}

export function authRoutes(app: Hono<AppEnv>) {
  app.get("/auth/config", (c) =>
    c.json({ debugUserEnabled: config.auth.debugUser.enabled }),
  )
  app.post("/auth/debug-sign-in", (c) => signInDebugUser(c.req.raw))
  // Password auth exists only so the trusted local debug endpoint can call the
  // internal Better Auth API. Never expose its generic public HTTP endpoints.
  app.on(
    ["GET", "POST"],
    [
      "/auth/sign-up/email",
      "/auth/sign-in/email",
      "/auth/request-password-reset",
      "/auth/reset-password",
      "/auth/change-password",
    ],
    (c) => c.json({ error: "Not found" }, 404),
  )
  app.on(["GET", "POST"], "/auth/reset-password/*", (c) =>
    c.json({ error: "Not found" }, 404),
  )
  app.on(["GET", "POST"], "/auth/*", (c) => auth.handler(c.req.raw))
}
