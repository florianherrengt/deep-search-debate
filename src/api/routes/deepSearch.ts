import { randomUUID } from "node:crypto"
import type { Hono } from "hono"
import { stream } from "hono/streaming"
import z from "zod"
import {
  deepSearch,
  type DeepSearchEvent,
} from "../agents/deep_search/index.ts"
import {
  createReplayableEventLog,
  type ReplayableEventLog,
} from "../helpers/replayableEventLog.ts"

export type DeepSearchJobEvent =
  | DeepSearchEvent
  | { type: "error"; message: string }
  | { type: "done" }

type DeepSearchJob = ReplayableEventLog<DeepSearchJobEvent>

const jobs = new Map<string, DeepSearchJob>()

const createDeepSearchJobInputSchema = z.object({
  researchRequest: z.string().min(1),
  maxSearches: z.number().int().positive().default(3),
  maxResultsPerSearch: z.number().int().positive().default(3),
})

function getErrorMessage(error: unknown): string {
  if (error instanceof Error && error.message) return error.message
  if (typeof error === "string" && error) return error
  return "Deep search failed"
}

/**
 * Runs one job, forwarding agent progress into its retained event log and adding
 * exactly one terminal `done` event after success or failure.
 */
async function runDeepSearchJob(
  job: DeepSearchJob,
  researchRequest: string,
  maxSearches: number,
  maxResultsPerSearch: number,
): Promise<void> {
  try {
    await deepSearch({
      researchRequest,
      maxSearches,
      maxResultsPerSearch,
      onEvent: (event) => job.publish(event),
    })
  } catch (error) {
    job.publish({ type: "error", message: getErrorMessage(error) })
  } finally {
    job.publish({ type: "done" })
    job.close()
  }
}

/**
 * Registers a new in-memory job before starting it in the background so callers
 * can subscribe immediately using the returned UUID.
 */
function createDeepSearchJob(
  researchRequest: string,
  maxSearches: number,
  maxResultsPerSearch: number,
): string {
  const id = randomUUID()
  const job = createReplayableEventLog<DeepSearchJobEvent>()

  jobs.set(id, job)
  void runDeepSearchJob(
    job,
    researchRequest,
    maxSearches,
    maxResultsPerSearch,
  )

  return id
}

/** Registers the job-creation and replay-and-follow HTTP endpoints. */
export function deepSearchJobs(app: Hono) {
  app.post("/deep-search", async (c) => {
    const input = createDeepSearchJobInputSchema.parse(await c.req.json())
    const id = createDeepSearchJob(
      input.researchRequest,
      input.maxSearches,
      input.maxResultsPerSearch,
    )

    c.header("Location", `/api/deep-search/${id}`)
    return c.json({ id }, 202)
  })

  app.get("/deep-search/:id", (c) => {
    const job = jobs.get(c.req.param("id"))

    if (!job) {
      return c.json({ error: "Deep search job not found" }, 404)
    }

    c.header("Content-Type", "application/x-ndjson")
    return stream(c, async (output) => {
      for await (const event of job.subscribe()) {
        await output.writeln(JSON.stringify(event))
      }
    })
  })
}
