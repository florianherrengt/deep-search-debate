import { zValidator } from "@hono/zod-validator"
import { asc } from "drizzle-orm"
import type { Hono } from "hono"
import z from "zod"

import {
  addUserCredits,
  getCreditAccount,
  hasAdminAccess,
} from "../credits.ts"
import { db } from "../db/index.ts"
import { user } from "../db/schema/index.ts"
import type { AppEnv } from "../types/auth.ts"

const grantCreditsBodySchema = z.object({
  credits: z.number().int().positive().max(100_000_000),
})

export function creditRoutes(app: Hono<AppEnv>): void {
  app.get("/credits", (c) => c.json(getCreditAccount(c.get("userId"))))

  app.use("/admin/*", async (c, next) => {
    if (!c.get("isAdmin")) return c.json({ error: "Forbidden" }, 403)
    await next()
  })

  app.get("/admin/users", (c) =>
    c.json({
      users: db
        .select({
          id: user.id,
          name: user.name,
          email: user.email,
          credits: user.credits,
          isAdmin: user.isAdmin,
        })
        .from(user)
        .orderBy(asc(user.email))
        .all()
        .map((account) => ({
          id: account.id,
          name: account.name,
          email: account.email,
          credits: account.credits,
          isAdmin: hasAdminAccess(account),
        })),
    }),
  )

  app.post(
    "/admin/users/:userId/credits",
    zValidator("json", grantCreditsBodySchema),
    (c) => {
      try {
        const credits = addUserCredits(
          c.req.param("userId"),
          c.req.valid("json").credits,
        )
        return c.json({ credits })
      } catch (error) {
        if (
          error instanceof Error &&
          error.message === "Credit account was not found"
        ) {
          return c.json({ error: "User not found" }, 404)
        }
        throw error
      }
    },
  )
}
