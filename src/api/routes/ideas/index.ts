import { zValidator } from "@hono/zod-validator"
import { and, desc, eq, getTableColumns } from "drizzle-orm"
import type { Hono } from "hono"
import { stream } from "hono/streaming"
import { db } from "../../db/index.ts"
import { ideaJobs as ideaJobsTable } from "../../db/schema/index.ts"
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

export type { IdeaJobEvent } from "./schemas.ts"

const { userId: _ideaJobOwnerId, ...publicIdeaJobColumns } =
  getTableColumns(ideaJobsTable)
void _ideaJobOwnerId

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
        .select(publicIdeaJobColumns)
        .from(ideaJobsTable)
        .where(
          and(
            eq(ideaJobsTable.slug, slug),
            ideaJobReadScope(c.get("viewerUserId")),
          ),
        )
        .get()
      if (!job) return c.json({ error: "Idea job not found" }, 404)
      return c.json({ ideaJob: job })
    },
  )
}

/** Registers authenticated idea creation and readable history. */
export function ideaJobs(app: Hono<AppEnv>, manager: IdeaJobManager) {
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
        .select(publicIdeaJobColumns)
        .from(ideaJobsTable)
        .where(ideaJobReadScope(c.get("userId")))
        .orderBy(
          desc(ideaJobsTable.createdAt),
          desc(ideaJobsTable.ideaJobId),
        )
        .limit(limit)
        .all()
      return c.json({ ideaJobs: jobs })
    },
  )
}
