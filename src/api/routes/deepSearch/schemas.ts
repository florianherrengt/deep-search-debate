import z from "zod"
import type { DeepSearchEvent } from "../../agents/deep_search/schemas.ts"
import type { ReplayableEventLog } from "../../helpers/replayableEventLog.ts"

export type DeepSearchJobEvent =
  | DeepSearchEvent
  | { type: "error"; message: string }
  | { type: "done" }
export type LiveDeepSearchJob = ReplayableEventLog<DeepSearchJobEvent>

export const deepSearchJobEventParamsSchema = z.object({
  deepSearchJobId: z.uuid(),
})

export const deepSearchJobParamsSchema = z.object({
  slug: z.string().trim().min(1).max(80),
})

export const createDeepSearchJobInputSchema = z.object({
  researchRequest: z.string().trim().min(1),
  maxSearches: z.number().int().positive().default(3),
  maxResultsPerSearch: z.number().int().positive().default(3),
})

export const listDeepSearchJobsInputSchema = z.object({
  limit: z.coerce.number().int().positive().max(200).default(100),
})
