import { createAuthClient } from "better-auth/react"
import z from "zod"

import { getJson } from "./api.ts"

export const authClient = createAuthClient()

export type AuthSession = typeof authClient.$Infer.Session

const authConfigSchema = z.object({
  debugUserEnabled: z.boolean(),
})

export function getAuthConfig(signal?: AbortSignal) {
  return getJson("/api/auth/config", authConfigSchema, signal)
}
