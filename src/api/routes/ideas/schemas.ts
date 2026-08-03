import z from "zod"
import { ideaJobStages } from "../../db/schema/index.ts"
import type { ReplayableEventLog } from "../../helpers/replayableEventLog.ts"

export const ideaSchema = z.object({
  title: z.string().trim().min(1),
  description: z.string().trim().min(1),
})

export type Idea = z.infer<typeof ideaSchema>
export type IdeaStage = (typeof ideaJobStages)[number]

export type IdeaJobEvent =
  | { type: "research-prompt-stream"; streamId: string }
  | {
      type: "deep-search-started"
      deepSearchJobId: string
      researchRequest: string
    }
  | { type: "research-summary-stream"; streamId: string }
  | { type: "idea-generation-stream"; streamId: string }
  | ({ type: "idea" } & Idea)
  | { type: "error"; message: string; stage: IdeaStage }
  | { type: "done" }

export type LiveIdeaJob = ReplayableEventLog<IdeaJobEvent>

// These controls are intentionally unbounded so trusted callers can configure
// arbitrarily large runs. A network deployment must enforce its own auth,
// quotas, request-size limits, and concurrency policy outside this schema.
export const createIdeaJobInputSchema = z.object({
  prompt: z.string().trim().min(1),
  numberOfIdeas: z.number().int().positive().default(12),
  deepSearchCount: z.number().int().positive().default(2),
  maxSearches: z.number().int().positive().default(3),
  maxResultsPerSearch: z.number().int().positive().default(3),
})

export const ideaJobParamsSchema = z.object({ ideaJobId: z.uuid() })

export const listIdeaJobsInputSchema = z.object({
  limit: z.coerce.number().int().positive().max(200).default(100),
})
