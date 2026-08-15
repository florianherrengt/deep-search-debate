import z from "zod"
import { config } from "../../config.ts"
import { ideaJobStages } from "../../db/schema/index.ts"
import type { ReplayableEventLog } from "../../helpers/replayableEventLog.ts"
import {
  deepSearchControlsSchema,
  deepSearchResearchRequestSchema,
  maximumSelectedPagesForChildren,
  rootSelectedPageBudgetMessage,
} from "../deepSearch/resourceLimits.ts"

export const ideaSchema = z.object({
  title: z.string().trim().min(1).max(160),
  description: z.string().trim().min(1).max(2_000),
})

export type Idea = z.infer<typeof ideaSchema>

const ideaEvaluationPointSchema = z.string().trim().min(1).max(400)
const ideaEvaluationPointsSchema = z
  .array(ideaEvaluationPointSchema)
  .min(2)
  .max(4)
  .refine(
    (points) =>
      new Set(points.map((point) => point.toLowerCase())).size ===
      points.length,
    { message: "Evaluation points must be distinct" },
  )

export const ideaEvaluationSchema = z.object({
  pros: ideaEvaluationPointsSchema,
  cons: ideaEvaluationPointsSchema,
  critique: z.string().trim().min(1).max(2_000),
})

export type IdeaEvaluation = z.infer<typeof ideaEvaluationSchema>
export type IdeaJobStage = (typeof ideaJobStages)[number]
export type IdeaEventStage =
  | IdeaJobStage
  | "evaluation"
  | "selection"
  | "refinement"
  | "idea-research"

export const MIN_SELECTED_IDEAS = 6
export const MAX_SELECTED_IDEAS = 12
const DEFAULT_IDEAS = 8

export const ideaSelectionSchema = z.object({
  selectedIdeaIds: z
    .array(z.uuid())
    .min(MIN_SELECTED_IDEAS)
    .max(MAX_SELECTED_IDEAS)
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
  | ({ type: "idea-evaluated"; ideaId: string } & IdeaEvaluation)
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
  | { type: "stop-requested" }
  | { type: "interrupted"; message: string }
  | { type: "error"; message: string; stage: IdeaEventStage }
  | { type: "done" }

export type LiveIdeaJob = ReplayableEventLog<IdeaJobEvent>

export const createIdeaJobInputSchema = deepSearchControlsSchema
  .safeExtend({
    prompt: deepSearchResearchRequestSchema,
    numberOfIdeas: z
      .number()
      .int()
      .min(MIN_SELECTED_IDEAS)
      .max(config.deepSearch.maxIdeaCount)
      .default(Math.min(DEFAULT_IDEAS, config.deepSearch.maxIdeaCount)),
    deepSearchCount: z
      .number()
      .int()
      .positive()
      .max(config.deepSearch.maxInitialIdeaSearches)
      .default(Math.min(2, config.deepSearch.maxInitialIdeaSearches)),
  })
  .refine(
    (input) =>
      maximumSelectedPagesForChildren(
        input,
        input.deepSearchCount +
          Math.min(input.numberOfIdeas, MAX_SELECTED_IDEAS),
      ) <= config.deepSearch.maxSelectedPagesPerRootJob,
    {
      message: rootSelectedPageBudgetMessage,
      path: ["maxRounds"],
    },
  )
export type CreateIdeaJobRequest = z.input<typeof createIdeaJobInputSchema>

export const ideaJobEventParamsSchema = z.object({ ideaJobId: z.uuid() })

export const ideaJobParamsSchema = z.object({
  slug: z.string().trim().min(1).max(80),
})

export const listIdeaJobsInputSchema = z.object({
  limit: z.coerce.number().int().positive().max(200).default(100),
})
