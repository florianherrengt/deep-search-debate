import { zValidator } from "@hono/zod-validator"
import { randomUUID } from "node:crypto"
import type { Hono } from "hono"
import z from "zod"

import { db } from "../db/index.ts"
import { waitlistEntries } from "../db/schema/index.ts"
import type { AppEnv } from "../types/auth.ts"

const joinWaitlistBodySchema = z.object({
  email: z.string().trim().toLowerCase().pipe(z.email().max(254)),
})

export function waitlistRoutes(app: Hono<AppEnv>): void {
  app.post(
    "/waitlist",
    zValidator("json", joinWaitlistBodySchema),
    (c) => {
      db.insert(waitlistEntries)
        .values({
          waitlistEntryId: randomUUID(),
          email: c.req.valid("json").email,
        })
        .onConflictDoNothing({ target: waitlistEntries.email })
        .run()

      return c.json({ joined: true })
    },
  )
}
