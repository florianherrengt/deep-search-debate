import type { Hono } from "hono"
import type { AppEnv } from "../types/auth.ts"

export function health(app: Hono<AppEnv>) {
  app.get("/health", (c) => c.json({ status: "ok" as const }))
}
