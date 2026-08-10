import z from "zod"
import { ideaJobStages } from "../../db/schema/index.ts"
import type { ReplayableEventLog } from "../../helpers/replayableEventLog.ts"

export const ideaSchema = z.object({
  title: z.string().trim().min(1),
  description: z.string().trim().min(1),
})

export type Idea = z.infer<typeof ideaSchema>
export type IdeaJobStage = (typeof ideaJobStages)[number]
export type IdeaEventStage =
  | IdeaJobStage
  | "critique"
  | "selection"
  | "refinement"
  | "idea-research"

export const MIN_SELECTED_IDEAS = 6
export const MAX_IDEAS = 100

export const ideaSelectionSchema = z.object({
  selectedIdeaIds: z
    .array(z.uuid())
    .min(MIN_SELECTED_IDEAS)
    .max(MAX_IDEAS)
    .refine((ids) => ids.length % 2 === 0, {
      message: "The number of selected ideas must be even",
    })
    .refine((ids) => new Set(ids).size === ids.length, {
      message: "Selected idea IDs must be unique",
    }),
})
type IdeaSelection = z.infer<typeof ideaSelectionSchema>

export type IdeaJobEvent =
  | { type: "research-prompt-stream"; streamId: string }
  | {
      type: "deep-search-started"
      deepSearchJobId: string
      title: string
      slug: string
      researchRequest: string
    }
  | { type: "research-summary-stream"; streamId: string }
  | { type: "idea-generation-stream"; streamId: string }
  | ({ type: "idea"; ideaId: string } & Idea)
  | {
      type: "critique-generation-stream"
      position: number
      streamId: string
    }
  | { type: "idea-selection-stream"; streamId: string }
  | ({ type: "selected-ideas" } & IdeaSelection)
  | {
      type: "idea-refinement-stream"
      ideaId: string
      streamId: string
    }
  | ({ type: "refined-idea"; ideaId: string } & Idea)
  | {
      type: "idea-deep-search-started"
      ideaId: string
      deepSearchJobId: string
      title: string
      slug: string
      researchRequest: string
    }
  | { type: "error"; message: string; stage: IdeaEventStage }
  | { type: "done" }

export type LiveIdeaJob = ReplayableEventLog<IdeaJobEvent>

// Search controls remain positive and otherwise configurable. Deployments must
// enforce quotas and concurrency policy outside this request schema.
export const createIdeaJobInputSchema = z.object({
  prompt: z.string().trim().min(1),
  numberOfIdeas: z.number().int().min(MIN_SELECTED_IDEAS).max(MAX_IDEAS).default(12),
  deepSearchCount: z.number().int().positive().default(2),
  maxSearches: z.number().int().positive().default(3),
  maxResultsPerSearch: z.number().int().positive().default(3),
})

export const ideaJobEventParamsSchema = z.object({ ideaJobId: z.uuid() })

export const ideaJobParamsSchema = z.object({
  slug: z.string().trim().min(1).max(80),
})

export const listIdeaJobsInputSchema = z.object({
  limit: z.coerce.number().int().positive().max(200).default(100),
})
