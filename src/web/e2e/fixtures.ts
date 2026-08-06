import { expect, test as base } from "@playwright/test"

type AuthenticatedFixtures = {
  authenticatedSession: void
}

export const test = base.extend<AuthenticatedFixtures>({
  request: async ({ page }, provide) => {
    await provide(page.request)
  },
  authenticatedSession: [
    async ({ request }, provide) => {
      const response = await request.post("/api/auth/debug-sign-in", {
        headers: {
          Origin: "http://localhost:5174",
          "X-Debug-Auth": "1",
        },
      })
      if (!response.ok()) {
        throw new Error(`Debug sign-in failed: ${response.status()}`)
      }
      await provide()
    },
    { auto: true },
  ],
})

export { expect }
