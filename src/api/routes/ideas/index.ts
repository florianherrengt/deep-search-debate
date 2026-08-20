import { zValidator } from "@hono/zod-validator"
import { and, desc, eq, getTableColumns } from "drizzle-orm"
import type { Hono } from "hono"
import { stream } from "hono/streaming"
import { db } from "../../db/index.ts"
import {
  debateJobs as debateJobsTable,
  ideaJobs as ideaJobsTable,
} from "../../db/schema/index.ts"
import type { IdeaJobManager } from "./manager.ts"
import { reconstructIdeaJobEvents } from "./replay.ts"
import {
  createIdeaJobInputSchema,
  ideaJobEventParamsSchema,
  ideaJobParamsSchema,
  listIdeaJobsInputSchema,
  type IdeaJobEvent,
} from "./schemas.ts"
import type { AppEnv } from "../../types/auth.ts"
import { ideaJobReadScope } from "../readAccess.ts"
import { stopRequestAppliesToJob } from "../researchCancellation.ts"
import {
  resultFeedbackInputSchema,
  resultFeedbackProjection,
  updateResultFeedback,
} from "../resultFeedback.ts"

export type { IdeaJobEvent } from "./schemas.ts"

const {
  userId: _ideaJobOwnerId,
  cancelRequestedAt: _cancelRequestedAt,
  feedbackRating: _feedbackRating,
  feedbackText: _feedbackText,
  ...publicIdeaJobColumns
} = getTableColumns(ideaJobsTable)

async function writeEvents(
  output: { writeln(value: string): Promise<unknown> },
  events: AsyncIterable<IdeaJobEvent> | IdeaJobEvent[],
): Promise<void> {
  for await (const event of events) {
    await output.writeln(JSON.stringify(event))
  }
}

/** Registers idea-run reads inherited from a public debate aggregate. */
export function ideaJobReads(app: Hono<AppEnv>, manager: IdeaJobManager) {
  app.get(
    "/idea-jobs/:ideaJobId/events",
    zValidator("param", ideaJobEventParamsSchema),
    (c) => {
      const { ideaJobId } = c.req.valid("param")
      const persistedEvents = reconstructIdeaJobEvents(
        ideaJobId,
        ideaJobReadScope(c.get("viewerUserId")),
      )
      if (!persistedEvents) {
        return c.json({ error: "Idea job not found" }, 404)
      }
      const liveJob = manager.getLiveJob(ideaJobId)

      c.header("Content-Type", "application/x-ndjson")
      return stream(c, async (output) => {
        await writeEvents(output, liveJob?.subscribe() ?? persistedEvents)
      })
    },
  )

  app.get(
    "/idea-jobs/:slug",
    zValidator("param", ideaJobParamsSchema),
    (c) => {
      const { slug } = c.req.valid("param")
      const job = db
        .select({
          ...publicIdeaJobColumns,
          ownerUserId: ideaJobsTable.userId,
          ownerFeedbackRating: ideaJobsTable.feedbackRating,
          ownerFeedbackText: ideaJobsTable.feedbackText,
          directCancelRequestedAt: ideaJobsTable.cancelRequestedAt,
          debateCancelRequestedAt: debateJobsTable.cancelRequestedAt,
          debateStatus: debateJobsTable.status,
          isPublic: debateJobsTable.isPublic,
        })
        .from(ideaJobsTable)
        .leftJoin(
          debateJobsTable,
          eq(debateJobsTable.debateJobId, ideaJobsTable.debateJobId),
        )
        .where(
          and(
            eq(ideaJobsTable.slug, slug),
            ideaJobReadScope(c.get("viewerUserId")),
          ),
        )
        .get()
      if (!job) return c.json({ error: "Idea job not found" }, 404)
      const {
        ownerUserId,
        ownerFeedbackRating,
        ownerFeedbackText,
        directCancelRequestedAt,
        debateCancelRequestedAt,
        debateStatus,
        isPublic: inheritedIsPublic,
        ...ideaJob
      } = job
      const isPublic = inheritedIsPublic ?? false
      const isOwner = c.get("viewerUserId") === ownerUserId
      const stopRequested = stopRequestAppliesToJob({
        status: ideaJob.status,
        completedAt: ideaJob.completedAt,
        cancelRequestedAt:
          debateCancelRequestedAt ?? directCancelRequestedAt,
      })
      return c.json({
        ideaJob: {
          ...ideaJob,
          feedback: isOwner
            ? resultFeedbackProjection(
                ownerFeedbackRating,
                ownerFeedbackText,
              )
            : null,
          stopRequested,
          canStop:
            isOwner &&
            ideaJob.debateJobId === null &&
            ideaJob.status === "running" &&
            !stopRequested,
          isIndexable: isPublic && debateStatus === "completed",
          isPublic,
        },
      })
    },
  )
}

/** Registers authenticated idea creation and readable history. */
export function ideaJobs(app: Hono<AppEnv>, manager: IdeaJobManager) {
  app.patch(
    "/idea-jobs/:ideaJobId/feedback",
    zValidator("param", ideaJobEventParamsSchema),
    zValidator("json", resultFeedbackInputSchema),
    (c) => {
      const { ideaJobId } = c.req.valid("param")
      const result = updateResultFeedback(c.req.valid("json"), {
        getOwnerStatus: () =>
          db
            .select({ status: ideaJobsTable.status })
            .from(ideaJobsTable)
            .where(
              and(
                eq(ideaJobsTable.ideaJobId, ideaJobId),
                eq(ideaJobsTable.userId, c.get("userId")),
              ),
            )
            .get()?.status,
        updateRating: (rating) =>
          db
            .update(ideaJobsTable)
            .set({
              feedbackRating: rating,
              ...(rating ? { feedbackText: null } : {}),
            })
            .where(
              and(
                eq(ideaJobsTable.ideaJobId, ideaJobId),
                eq(ideaJobsTable.userId, c.get("userId")),
                eq(ideaJobsTable.status, "completed"),
              ),
            )
            .returning({
              feedbackRating: ideaJobsTable.feedbackRating,
              feedbackText: ideaJobsTable.feedbackText,
            })
            .get(),
        updateText: (text) =>
          db
            .update(ideaJobsTable)
            .set({ feedbackText: text })
            .where(
              and(
                eq(ideaJobsTable.ideaJobId, ideaJobId),
                eq(ideaJobsTable.userId, c.get("userId")),
                eq(ideaJobsTable.status, "completed"),
                eq(ideaJobsTable.feedbackRating, false),
              ),
            )
            .returning({
              feedbackRating: ideaJobsTable.feedbackRating,
              feedbackText: ideaJobsTable.feedbackText,
            })
            .get(),
      })

      switch (result.kind) {
        case "updated":
          return c.json({ feedback: result.feedback })
        case "not-found":
          return c.json({ error: "Idea job not found" }, 404)
        case "not-completed":
          return c.json(
            { error: "Feedback requires a completed idea job" },
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
    "/idea-jobs/:ideaJobId/cancel",
    zValidator("param", ideaJobEventParamsSchema),
    (c) => {
      const { ideaJobId } = c.req.valid("param")
      const result = manager.stop(c.get("userId"), ideaJobId)
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
          return c.json({ error: "Idea job not found" }, 404)
        case "not-root":
          return c.json({ error: "Only root idea jobs can be stopped" }, 409)
        case "not-cancellable":
          return c.json({ error: `Idea job is ${result.status}` }, 409)
      }
    },
  )

  app.post(
    "/idea-jobs",
    zValidator("json", createIdeaJobInputSchema),
    async (c) => {
      const input = c.req.valid("json")
      const { ideaJobId, slug, completion } = await manager.start(
        c.get("userId"),
        input,
      )
      void completion.catch((error: unknown) => {
        console.error(`Idea job ${ideaJobId} background task failed`, error)
      })

      c.header("Location", `/api/idea-jobs/${slug}`)
      return c.json({ ideaJobId, slug }, 202)
    },
  )

  app.get(
    "/idea-jobs",
    zValidator("query", listIdeaJobsInputSchema),
    (c) => {
      const { limit } = c.req.valid("query")
      const jobs = db
        .select({
          job: publicIdeaJobColumns,
          directCancelRequestedAt: ideaJobsTable.cancelRequestedAt,
          debateCancelRequestedAt: debateJobsTable.cancelRequestedAt,
        })
        .from(ideaJobsTable)
        .leftJoin(
          debateJobsTable,
          eq(debateJobsTable.debateJobId, ideaJobsTable.debateJobId),
        )
        .where(eq(ideaJobsTable.userId, c.get("userId")))
        .orderBy(
          desc(ideaJobsTable.createdAt),
          desc(ideaJobsTable.ideaJobId),
        )
        .limit(limit)
        .all()
      return c.json({
        ideaJobs: jobs.map(
          ({ job, directCancelRequestedAt, debateCancelRequestedAt }) => ({
            ...job,
            stopRequested: stopRequestAppliesToJob({
              status: job.status,
              completedAt: job.completedAt,
              cancelRequestedAt:
                debateCancelRequestedAt ?? directCancelRequestedAt,
            }),
          }),
        ),
      })
    },
  )
}
