import { zValidator } from "@hono/zod-validator"
import { and, desc, eq } from "drizzle-orm"
import type { Hono } from "hono"
import { stream } from "hono/streaming"

import { db } from "../../db/index.ts"
import {
  debateJobs as debateJobsTable,
  ideaJobs as ideaJobsTable,
} from "../../db/schema/index.ts"
import type { DebateJobManager } from "./manager.ts"
import {
  createDebateJobInputSchema,
  debateJobParamsSchema,
  listDebateJobsInputSchema,
  listDebateJobsResponseSchema,
  mutableDebateJobFieldsSchema,
  updateDebateJobInputSchema,
  type DebateJobEvent,
} from "./schemas.ts"
import { getDebateJobSnapshot } from "./snapshot.ts"
import type { AppEnv } from "../../types/auth.ts"
import { debateJobReadScope } from "../readAccess.ts"

function reconstructDebateJobEvents(
  debateJobId: string,
  viewerUserId: string | null,
): DebateJobEvent[] | undefined {
  const job = db
    .select({ status: debateJobsTable.status, error: debateJobsTable.error })
    .from(debateJobsTable)
    .where(
      and(
        eq(debateJobsTable.debateJobId, debateJobId),
        debateJobReadScope(viewerUserId),
      ),
    )
    .get()
  if (!job) return

  return [
    { type: "updated" },
    ...(job.error ? [{ type: "error" as const, message: job.error }] : []),
    ...(job.status === "running" ? [] : [{ type: "done" as const }]),
  ]
}

async function writeEvents(
  output: { writeln(value: string): Promise<unknown> },
  events: AsyncIterable<DebateJobEvent> | DebateJobEvent[],
): Promise<void> {
  for await (const event of events) {
    await output.writeln(JSON.stringify(event))
  }
}

/** Registers debate reads available to owners and anonymous public viewers. */
export function debateJobReads(
  app: Hono<AppEnv>,
  manager: DebateJobManager,
): void {
  app.get(
    "/debate-jobs/:debateJobId/events",
    zValidator("param", debateJobParamsSchema),
    (c) => {
      const { debateJobId } = c.req.valid("param")
      const persistedEvents = reconstructDebateJobEvents(
        debateJobId,
        c.get("viewerUserId"),
      )
      if (!persistedEvents) {
        return c.json({ error: "Debate job not found" }, 404)
      }
      const liveJob = manager.getLiveJob(debateJobId)

      c.header("Content-Type", "application/x-ndjson")
      return stream(c, async (output) => {
        await writeEvents(output, liveJob?.subscribe() ?? persistedEvents)
      })
    },
  )

  app.get(
    "/debate-jobs/:debateJobId",
    zValidator("param", debateJobParamsSchema),
    (c) => {
      const { debateJobId } = c.req.valid("param")
      const debateJob = getDebateJobSnapshot(
        debateJobId,
        c.get("viewerUserId"),
      )
      if (!debateJob) return c.json({ error: "Debate job not found" }, 404)
      return c.json({ debateJob })
    },
  )
}

/** Registers authenticated debate creation, history, and owner mutations. */
export function debateJobs(app: Hono<AppEnv>, manager: DebateJobManager): void {
  app.post(
    "/debate-jobs",
    zValidator("json", createDebateJobInputSchema),
    (c) => {
      const { debateJobId, completion } = manager.start(
        c.get("userId"),
        c.req.valid("json"),
      )
      void completion.catch((error: unknown) => {
        console.error(`Debate job ${debateJobId} background task failed`, error)
      })

      c.header("Location", `/api/debate-jobs/${debateJobId}`)
      return c.json({ debateJobId }, 202)
    },
  )

  app.get(
    "/debate-jobs",
    zValidator("query", listDebateJobsInputSchema),
    (c) => {
      const { limit } = c.req.valid("query")
      const summaries = db
        .select({
          debateJobId: debateJobsTable.debateJobId,
          ideaJobId: ideaJobsTable.ideaJobId,
          prompt: ideaJobsTable.prompt,
          isPublic: debateJobsTable.isPublic,
          stage: debateJobsTable.stage,
          status: debateJobsTable.status,
          error: debateJobsTable.error,
          createdAt: debateJobsTable.createdAt,
          completedAt: debateJobsTable.completedAt,
        })
        .from(debateJobsTable)
        .innerJoin(
          ideaJobsTable,
          eq(debateJobsTable.debateJobId, ideaJobsTable.debateJobId),
        )
        .where(debateJobReadScope(c.get("userId")))
        .orderBy(
          desc(debateJobsTable.createdAt),
          desc(debateJobsTable.debateJobId),
        )
        .limit(limit)
        .all()

      const response = listDebateJobsResponseSchema.parse({
        debateJobs: summaries.map((summary) => ({
          ...summary,
          createdAt: summary.createdAt.toISOString(),
          completedAt: summary.completedAt?.toISOString() ?? null,
        })),
      })
      return c.json(response)
    },
  )

  app.patch(
    "/debate-jobs/:debateJobId",
    zValidator("param", debateJobParamsSchema),
    zValidator("json", updateDebateJobInputSchema),
    (c) => {
      const { debateJobId } = c.req.valid("param")
      const update = c.req.valid("json")
      const updated = db
        .update(debateJobsTable)
        .set(update)
        .where(
          and(
            eq(debateJobsTable.debateJobId, debateJobId),
            eq(debateJobsTable.userId, c.get("userId")),
          ),
        )
        .returning({ isPublic: debateJobsTable.isPublic })
        .get()
      if (!updated) return c.json({ error: "Debate job not found" }, 404)
      return c.json(mutableDebateJobFieldsSchema.parse(updated))
    },
  )
}
