import z from "zod"

import { getJson, postJson } from "./api.ts"

export const creditAccountQueryKey = ["credit-account"] as const
export const adminUsersQueryKey = ["admin", "users"] as const

const creditAccountSchema = z.object({
  credits: z.number().int(),
  isAdmin: z.boolean(),
})

const adminUserSchema = z.object({
  id: z.string(),
  name: z.string(),
  email: z.email(),
  credits: z.number().int(),
  isAdmin: z.boolean(),
})

const adminUsersSchema = z.object({ users: z.array(adminUserSchema) })
const grantResultSchema = z.object({ credits: z.number().int() })

export function getCreditAccount(signal?: AbortSignal) {
  return getJson("/api/credits", creditAccountSchema, signal)
}

export function getAdminUsers(signal?: AbortSignal) {
  return getJson("/api/admin/users", adminUsersSchema, signal)
}

export function grantUserCredits(input: { userId: string; credits: number }) {
  return postJson(
    `/api/admin/users/${encodeURIComponent(input.userId)}/credits`,
    { credits: input.credits },
    grantResultSchema,
  )
}
