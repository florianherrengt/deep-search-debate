import { expect, test as base, type APIRequestContext } from "@playwright/test"
import z from "zod"

type AuthenticatedFixtures = {
  authenticatedSession: void
}

const adminUsersResponseSchema = z.object({
  users: z.array(
    z.object({
      credits: z.number().int(),
      id: z.string().min(1),
      name: z.string().min(1),
    }),
  ),
})
const debugCreditTarget = 1_000_000
let debugCreditsReady = false

async function ensureDebugUserCredits(
  request: APIRequestContext,
): Promise<void> {
  if (debugCreditsReady) return

  const usersResponse = await request.get("/api/admin/users")
  if (!usersResponse.ok()) {
    throw new Error(`Admin user lookup failed: ${usersResponse.status()}`)
  }
  const usersBody: unknown = await usersResponse.json()
  const debugUser = adminUsersResponseSchema
    .parse(usersBody)
    .users.find((user) => user.name === "Debug User")
  if (!debugUser) throw new Error("Debug user was not found after sign-in")

  const creditsToGrant = debugCreditTarget - debugUser.credits
  if (creditsToGrant > 0) {
    const grantResponse = await request.post(
      `/api/admin/users/${encodeURIComponent(debugUser.id)}/credits`,
      {
        data: { credits: creditsToGrant },
        headers: {
          Origin:
            process.env.PLAYWRIGHT_WEB_ORIGIN ?? "http://localhost:5174",
        },
      },
    )
    if (!grantResponse.ok()) {
      throw new Error(`Debug credit grant failed: ${grantResponse.status()}`)
    }
  }

  debugCreditsReady = true
}

export const test = base.extend<AuthenticatedFixtures>({
  request: async ({ page }, provide) => {
    await provide(page.request)
  },
  authenticatedSession: [
    async ({ request }, provide) => {
      const response = await request.post("/api/auth/debug-sign-in", {
        headers: {
          Origin:
            process.env.PLAYWRIGHT_WEB_ORIGIN ?? "http://localhost:5174",
          "X-Debug-Auth": "1",
        },
      })
      if (!response.ok()) {
        throw new Error(`Debug sign-in failed: ${response.status()}`)
      }
      await ensureDebugUserCredits(request)
      await provide()
    },
    { auto: true },
  ],
})

export { expect }
