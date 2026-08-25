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
  mutableDebateJobFieldsSchema,
  updateDebateJobInputSchema,
  type DebateJobEvent,
} from "./schemas.ts"
import { getDebateJobSnapshot } from "./snapshot.ts"
import type { AppEnv } from "../../types/auth.ts"
import { debateJobReadScope } from "../readAccess.ts"
import {
  resultFeedbackInputSchema,
  updateResultFeedback,
} from "../resultFeedback.ts"

function reconstructDebateJobEvents(
  debateJobId: string,
  viewerUserId: string | null,
): DebateJobEvent[] | undefined {
  const job = db
    .select({
      status: debateJobsTable.status,
      error: debateJobsTable.error,
      cancelRequestedAt: debateJobsTable.cancelRequestedAt,
    })
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
    ...(job.error && job.cancelRequestedAt === null
      ? [{ type: "error" as const, message: job.error }]
      : []),
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
    zValidator("param", debateJobEventParamsSchema),
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
    "/debate-jobs/:slug",
    zValidator("param", debateJobParamsSchema),
    (c) => {
      const { slug } = c.req.valid("param")
      const visibleJob = db
        .select({ id: debateJobsTable.debateJobId })
        .from(debateJobsTable)
        .innerJoin(
          ideaJobsTable,
          eq(debateJobsTable.debateJobId, ideaJobsTable.debateJobId),
        )
        .where(
          and(
            eq(ideaJobsTable.slug, slug),
            debateJobReadScope(c.get("viewerUserId")),
          ),
        )
        .get()
      if (!visibleJob) return c.json({ error: "Debate job not found" }, 404)
      const debateJob = getDebateJobSnapshot(
        visibleJob.id,
        c.get("viewerUserId"),
      )
      if (!debateJob) return c.json({ error: "Debate job not found" }, 404)
      return c.json({ debateJob })
    },
  )
}

/** Registers authenticated debate creation, history, and owner mutations. */
export function debateJobs(app: Hono<AppEnv>, manager: DebateJobManager): void {
  app.patch(
    "/debate-jobs/:debateJobId/feedback",
    zValidator("param", debateJobEventParamsSchema),
    zValidator("json", resultFeedbackInputSchema),
    (c) => {
      const { debateJobId } = c.req.valid("param")
      const result = updateResultFeedback(c.req.valid("json"), {
        getOwnerStatus: () =>
          db
            .select({ status: debateJobsTable.status })
            .from(debateJobsTable)
            .where(
              and(
                eq(debateJobsTable.debateJobId, debateJobId),
                eq(debateJobsTable.userId, c.get("userId")),
              ),
            )
            .get()?.status,
        updateRating: (rating) =>
          db
            .update(debateJobsTable)
            .set({
              feedbackRating: rating,
              ...(rating ? { feedbackText: null } : {}),
            })
            .where(
              and(
                eq(debateJobsTable.debateJobId, debateJobId),
                eq(debateJobsTable.userId, c.get("userId")),
                eq(debateJobsTable.status, "completed"),
              ),
            )
            .returning({
              feedbackRating: debateJobsTable.feedbackRating,
              feedbackText: debateJobsTable.feedbackText,
            })
            .get(),
        updateText: (text) =>
          db
            .update(debateJobsTable)
            .set({ feedbackText: text })
            .where(
              and(
                eq(debateJobsTable.debateJobId, debateJobId),
                eq(debateJobsTable.userId, c.get("userId")),
                eq(debateJobsTable.status, "completed"),
                eq(debateJobsTable.feedbackRating, false),
              ),
            )
            .returning({
              feedbackRating: debateJobsTable.feedbackRating,
              feedbackText: debateJobsTable.feedbackText,
            })
            .get(),
      })

      switch (result.kind) {
        case "updated":
          return c.json({ feedback: result.feedback })
        case "not-found":
          return c.json({ error: "Debate job not found" }, 404)
        case "not-completed":
          return c.json(
            { error: "Feedback requires a completed debate job" },
            409,
          )
        case "negative-rating-required":
          return c.json(
            { error: "Written feedback requires a negative rating" },
            409,
          )
      }
    },
  )

  app.post(
    "/debate-jobs/:debateJobId/cancel",
    zValidator("param", debateJobEventParamsSchema),
    (c) => {
      const { debateJobId } = c.req.valid("param")
      const result = manager.stop(c.get("userId"), debateJobId)
      switch (result.kind) {
        case "requested":
          return c.json(
            {
              status: "cancellation-requested" as const,
              cancelRequestedAt: result.cancelRequestedAt,
            },
            202,
          )
        case "already-interrupted":
          return c.json(
            {
              status: "interrupted" as const,
              cancelRequestedAt: result.cancelRequestedAt,
              completedAt: result.completedAt,
            },
            200,
          )
        case "not-found":
          return c.json({ error: "Debate job not found" }, 404)
        case "not-cancellable":
          return c.json({ error: `Debate job is ${result.status}` }, 409)
      }
    },
  )

  app.post(
    "/debate-jobs/:debateJobId/resume",
    zValidator("param", debateJobEventParamsSchema),
    (c) => {
      const { debateJobId } = c.req.valid("param")
      const persisted = db
        .select({ status: debateJobsTable.status })
        .from(debateJobsTable)
        .where(
          and(
            eq(debateJobsTable.debateJobId, debateJobId),
            eq(debateJobsTable.userId, c.get("userId")),
          ),
        )
        .get()
      if (!persisted) return c.json({ error: "Debate job not found" }, 404)
      if (persisted.status === "completed") {
        return c.json({ error: "Completed debate jobs cannot be resumed" }, 409)
      }
      const { completion } = manager.resumeExisting(debateJobId, {
        userId: c.get("userId"),
      })
      void completion.catch(() => {})
      return c.json({ status: "running" as const }, 202)
    },
  )

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
          isPublic: debateJobsTable.isPublic,
          stage: debateJobsTable.stage,
          status: debateJobsTable.status,
          cancelRequestedAt: debateJobsTable.cancelRequestedAt,
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
        debateJobs: summaries.map(
          ({ cancelRequestedAt, ...summary }) => ({
            ...summary,
            stopRequested: cancelRequestedAt !== null,
            createdAt: summary.createdAt.toISOString(),
            completedAt: summary.completedAt?.toISOString() ?? null,
          }),
        ),
      })
      return c.json(response)
    },
  )

  app.patch(
    "/debate-jobs/:debateJobId",
    zValidator("param", debateJobEventParamsSchema),
    zValidator("json", updateDebateJobInputSchema),
    (c) => {
      const { debateJobId } = c.req.valid("param")
      const update = c.req.valid("json")
      const current = db
        .select({
          isPublic: debateJobsTable.isPublic,
          status: debateJobsTable.status,
        })
        .from(debateJobsTable)
        .where(
          and(
            eq(debateJobsTable.debateJobId, debateJobId),
            eq(debateJobsTable.userId, c.get("userId")),
          ),
        )
        .get()
      if (!current) return c.json({ error: "Debate job not found" }, 404)
      if (
        current.status === "running" &&
        current.isPublic &&
        update.isPublic === false
      ) {
        // Existing anonymous NDJSON responses cannot be revoked mid-response.
        // Keep visibility monotonic until all live streams have terminated.
        return c.json(
          {
            error:
              "A public debate cannot be made private while it is running",
          },
          409,
        )
      }
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
