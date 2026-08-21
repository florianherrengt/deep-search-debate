import { eq } from "drizzle-orm"
import { Hono } from "hono"
import { afterEach, beforeEach, describe, expect, it } from "vitest"
import z from "zod"

import { config } from "../config.ts"
import { getCreditAccount } from "../credits.ts"
import { db } from "../db/index.ts"
import { user } from "../db/schema/index.ts"
import type { AppEnv } from "../types/auth.ts"
import { creditRoutes } from "./credits.ts"

const adminId = "credits-route-admin"
const memberId = "credits-route-member"
const originalAdminEmail = config.auth.adminEmail
const listedUsersSchema = z.object({
  users: z.array(z.object({ id: z.string(), isAdmin: z.boolean() })),
})

function createApp(userId: string) {
  const app = new Hono<AppEnv>().basePath("/api")
  app.use("*", async (c, next) => {
    c.set("userId", userId)
    c.set("isAdmin", getCreditAccount(userId).isAdmin)
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
  config.auth.adminEmail = originalAdminEmail
  db.delete(user).where(eq(user.id, adminId)).run()
  db.delete(user).where(eq(user.id, memberId)).run()
})

describe("credit routes", () => {
  it("returns the current account", async () => {
    const response = await createApp(memberId).request("/api/credits")

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toEqual({
      credits: 500,
      isAdmin: false,
    })
  })

  it("authorizes the configured owner without promoting the database user", async () => {
    config.auth.adminEmail = "admin@example.com"
    db.update(user)
      .set({ email: "admin@example.com" })
      .where(eq(user.id, memberId))
      .run()
    const app = createApp(memberId)

    const creditsResponse = await app.request("/api/credits")
    expect(creditsResponse.status).toBe(200)
    await expect(creditsResponse.json()).resolves.toEqual({
      credits: 500,
      isAdmin: true,
    })

    const usersResponse = await app.request("/api/admin/users")
    expect(usersResponse.status).toBe(200)
    const listedUsers = listedUsersSchema.parse(await usersResponse.json())
    expect(listedUsers.users).toContainEqual({ id: memberId, isAdmin: true })
    expect(
      db.select({ isAdmin: user.isAdmin })
        .from(user)
        .where(eq(user.id, memberId))
        .get(),
    ).toEqual({ isAdmin: false })

    config.auth.adminEmail = "different-admin@example.com"
    const revokedCreditsResponse = await app.request("/api/credits")
    await expect(revokedCreditsResponse.json()).resolves.toEqual({
      credits: 500,
      isAdmin: false,
    })
    expect((await app.request("/api/admin/users")).status).toBe(403)
  })

  it("matches the configured admin against a trimmed mixed-case stored email", async () => {
    config.auth.adminEmail = "admin@example.com"
    db.update(user)
      .set({ email: "  AdMiN@ExAmPlE.CoM  " })
      .where(eq(user.id, memberId))
      .run()

    const response = await createApp(memberId).request("/api/admin/users")

    expect(response.status).toBe(200)
    const listedUsers = listedUsersSchema.parse(await response.json())
    expect(listedUsers.users).toContainEqual({ id: memberId, isAdmin: true })
  })

  it("authorizes a matching email without requiring a verification flag", async () => {
    config.auth.adminEmail = "admin@example.com"
    db.update(user)
      .set({ email: "admin@example.com", emailVerified: false })
      .where(eq(user.id, memberId))
      .run()
    const app = createApp(memberId)

    const creditsResponse = await app.request("/api/credits")
    await expect(creditsResponse.json()).resolves.toEqual({
      credits: 500,
      isAdmin: true,
    })
    expect((await app.request("/api/admin/users")).status).toBe(200)
  })

  it("rejects a user whose email does not match the configured admin", async () => {
    config.auth.adminEmail = "admin@example.com"

    const response = await createApp(memberId).request("/api/admin/users")

    expect(response.status).toBe(403)
  })

  it("preserves a persisted administrator and lets them increment a balance", async () => {
    config.auth.adminEmail = "different-admin@example.com"
    const app = createApp(adminId)
    const accountResponse = await app.request("/api/credits")
    await expect(accountResponse.json()).resolves.toEqual({
      credits: 500,
      isAdmin: true,
    })

    const response = await app.request(`/api/admin/users/${memberId}/credits`, {
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
})
