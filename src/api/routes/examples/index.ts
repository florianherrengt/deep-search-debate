import { and, eq, inArray } from "drizzle-orm"
import type { Hono } from "hono"

import { config } from "../../config.ts"
import { db } from "../../db/index.ts"
import {
  debateJobs as debateJobsTable,
  ideaJobs as ideaJobsTable,
} from "../../db/schema/index.ts"
import type { AppEnv } from "../../types/auth.ts"
import { exampleDebatesResponseSchema } from "./schemas.ts"

/** Registers the public, operator-curated debate examples listing. */
export function exampleDebateReads(
  app: Hono<AppEnv>,
  debateJobIds: readonly string[] = config.examples.debateIds,
): void {
  app.get("/examples", (c) => {
    if (debateJobIds.length === 0) {
      return c.json(exampleDebatesResponseSchema.parse({ debates: [] }))
    }

    const rows = db
      .select({
        debateJobId: debateJobsTable.debateJobId,
        prompt: ideaJobsTable.prompt,
        slug: ideaJobsTable.slug,
        title: ideaJobsTable.title,
      })
      .from(debateJobsTable)
      .innerJoin(
        ideaJobsTable,
        eq(debateJobsTable.debateJobId, ideaJobsTable.debateJobId),
      )
      .where(
        and(
          inArray(debateJobsTable.debateJobId, debateJobIds),
          eq(debateJobsTable.isPublic, true),
          eq(debateJobsTable.status, "completed"),
        ),
      )
      .all()
    const rowsById = new Map(rows.map((row) => [row.debateJobId, row]))

    return c.json(
      exampleDebatesResponseSchema.parse({
        debates: debateJobIds.flatMap((debateJobId) => {
          const row = rowsById.get(debateJobId)
          return row === undefined ? [] : [row]
        }),
      }),
    )
  })
}
