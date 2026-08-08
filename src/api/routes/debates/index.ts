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
  debateJobEventParamsSchema,
  debateJobParamsSchema,
  listDebateJobsInputSchema,
  listDebateJobsResponseSchema,
  type DebateJobEvent,
} from "./schemas.ts"
import { getDebateJobSnapshot } from "./snapshot.ts"
import type { AppEnv } from "../../types/auth.ts"

function reconstructDebateJobEvents(
  debateJobId: string,
): DebateJobEvent[] | undefined {
  const job = db
    .select({ status: debateJobsTable.status, error: debateJobsTable.error })
    .from(debateJobsTable)
    .where(eq(debateJobsTable.debateJobId, debateJobId))
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

/** Registers durable debate creation, snapshot, and replay-and-follow routes. */
export function debateJobs(app: Hono<AppEnv>, manager: DebateJobManager): void {
  app.post(
    "/debate-jobs",
    zValidator("json", createDebateJobInputSchema),
    async (c) => {
      const { debateJobId, slug, completion } = await manager.start(
        c.get("userId"),
        c.req.valid("json"),
      )
      void completion.catch((error: unknown) => {
        console.error(`Debate job ${debateJobId} background task failed`, error)
      })

      c.header("Location", `/api/debate-jobs/${slug}`)
      return c.json({ debateJobId, slug }, 202)
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
          title: ideaJobsTable.title,
          slug: ideaJobsTable.slug,
          prompt: ideaJobsTable.prompt,
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
        .where(eq(debateJobsTable.userId, c.get("userId")))
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

  app.get(
    "/debate-jobs/:debateJobId/events",
    zValidator("param", debateJobEventParamsSchema),
    (c) => {
      const { debateJobId } = c.req.valid("param")
      const ownedJob = db
        .select({ id: debateJobsTable.debateJobId })
        .from(debateJobsTable)
        .where(
          and(
            eq(debateJobsTable.debateJobId, debateJobId),
            eq(debateJobsTable.userId, c.get("userId")),
          ),
        )
        .get()
      if (!ownedJob) return c.json({ error: "Debate job not found" }, 404)
      const liveJob = manager.getLiveJob(debateJobId)
      const persistedEvents = liveJob
        ? undefined
        : reconstructDebateJobEvents(debateJobId)
      if (!liveJob && !persistedEvents) {
        return c.json({ error: "Debate job not found" }, 404)
      }

      c.header("Content-Type", "application/x-ndjson")
      return stream(c, async (output) => {
        await writeEvents(output, liveJob?.subscribe() ?? persistedEvents!)
      })
    },
  )

  app.get(
    "/debate-jobs/:slug",
    zValidator("param", debateJobParamsSchema),
    (c) => {
      const { slug } = c.req.valid("param")
      const ownedJob = db
        .select({ id: debateJobsTable.debateJobId })
        .from(debateJobsTable)
        .innerJoin(
          ideaJobsTable,
          eq(debateJobsTable.debateJobId, ideaJobsTable.debateJobId),
        )
        .where(
          and(
            eq(ideaJobsTable.slug, slug),
            eq(debateJobsTable.userId, c.get("userId")),
          ),
        )
        .get()
      if (!ownedJob) return c.json({ error: "Debate job not found" }, 404)
      const debateJob = getDebateJobSnapshot(ownedJob.id)
      if (!debateJob) return c.json({ error: "Debate job not found" }, 404)
      return c.json({ debateJob })
    },
  )
}
