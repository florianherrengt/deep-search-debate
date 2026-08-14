import { eq } from "drizzle-orm"
import { Hono } from "hono"
import { afterEach, beforeEach, describe, expect, it } from "vitest"

import { db } from "../db/index.ts"
import { user } from "../db/schema/index.ts"
import type { AppEnv } from "../types/auth.ts"
import { creditRoutes } from "./credits.ts"

const adminId = "credits-route-admin"
const memberId = "credits-route-member"

function createApp(input: { userId: string; isAdmin: boolean }) {
  const app = new Hono<AppEnv>().basePath("/api")
  app.use("*", async (c, next) => {
    c.set("userId", input.userId)
    c.set("isAdmin", input.isAdmin)
    await next()
  })
  creditRoutes(app)
  return app
}

beforeEach(() => {
  db.insert(user)
    .values([
      {
        id: adminId,
        name: "Admin",
        email: "credits-admin@example.com",
        isAdmin: true,
      },
      {
        id: memberId,
        name: "Member",
        email: "credits-member@example.com",
      },
    ])
    .run()
})

afterEach(() => {
  db.delete(user).where(eq(user.id, adminId)).run()
  db.delete(user).where(eq(user.id, memberId)).run()
})

describe("credit routes", () => {
  it("returns the current account", async () => {
    const response = await createApp({ userId: memberId, isAdmin: false })
      .request("/api/credits")

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toEqual({
      credits: 500,
      isAdmin: false,
    })
  })

  it("lets an admin increment a user's balance", async () => {
    const response = await createApp({ userId: adminId, isAdmin: true })
      .request(`/api/admin/users/${memberId}/credits`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ credits: 1_000 }),
      })

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toEqual({ credits: 1_500 })
    expect(
      db.select({ credits: user.credits })
        .from(user)
        .where(eq(user.id, memberId))
        .get(),
    ).toEqual({ credits: 1_500 })
  })

  it("rejects admin routes for a regular user", async () => {
    const response = await createApp({ userId: memberId, isAdmin: false })
      .request("/api/admin/users")

    expect(response.status).toBe(403)
  })
})
