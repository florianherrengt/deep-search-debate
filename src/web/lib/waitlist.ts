import z from "zod"
import { postJson } from "./api.ts"

export const waitlistEmailSchema = z
  .string()
  .trim()
  .toLowerCase()
  .max(254)
  .pipe(z.email())

const waitlistResponseSchema = z.object({
  joined: z.literal(true),
})

export async function joinWaitlist(email: string, signal?: AbortSignal) {
  return postJson(
    "/api/waitlist",
    { email: waitlistEmailSchema.parse(email) },
    waitlistResponseSchema,
    signal,
  )
}
