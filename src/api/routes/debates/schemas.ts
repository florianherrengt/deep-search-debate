import z from "zod"

import { config } from "../../config.ts"
import type { ReplayableEventLog } from "../../helpers/replayableEventLog.ts"
import { debateJobStages, jobStatuses } from "../../db/schema/index.ts"
import { createIdeaJobInputSchema } from "../ideas/schemas.ts"
import { maximumSelectedPagesForChildren } from "../deepSearch/resourceLimits.ts"

const debatePageBudgetMessage =
  `A debate cannot select more than ` +
  `${config.debate.maxSelectedPagesPerJob} research pages`

export const createDebateJobInputSchema = createIdeaJobInputSchema
  .safeExtend({
    numberOfIdeas: z
      .number()
      .int()
      .min(6)
      .max(config.debate.maxIdeaCount)
      .default(Math.min(8, config.debate.maxIdeaCount)),
    deepSearchCount: z
      .number()
      .int()
      .positive()
      .max(config.debate.maxInitialDeepSearches)
      .default(Math.min(1, config.debate.maxInitialDeepSearches)),
    maxSearches: z
      .number()
      .int()
      .positive()
      .max(config.debate.maxSearchesPerChild)
      .default(Math.min(2, config.debate.maxSearchesPerChild)),
    maxResultsPerSearch: z
      .number()
      .int()
      .positive()
      .max(config.debate.maxResultsPerSearch)
      .default(Math.min(2, config.debate.maxResultsPerSearch)),
    maxRounds: z
      .number()
      .int()
      .positive()
      .max(config.debate.maxResearchRoundsPerChild)
      .default(Math.min(1, config.debate.maxResearchRoundsPerChild)),
    isPublic: z.boolean().default(false),
  })
  .refine(
    (input) =>
      maximumSelectedPagesForChildren(
        input,
        input.deepSearchCount + input.numberOfIdeas,
      ) <= config.debate.maxSelectedPagesPerJob,
    { message: debatePageBudgetMessage, path: ["maxRounds"] },
  )

export type CreateDebateJobRequest = z.input<
  typeof createDebateJobInputSchema
>

export type DebateJobStage = (typeof debateJobStages)[number]

export const debateJobEventParamsSchema = z.object({ debateJobId: z.uuid() })

export const debateJobParamsSchema = z.object({
  slug: z.string().trim().min(1).max(80),
})

export const mutableDebateJobFieldsSchema = z.object({
  isPublic: z.boolean(),
})

export const updateDebateJobInputSchema = mutableDebateJobFieldsSchema
  .partial()
  .refine((update) => Object.keys(update).length > 0, {
    message: "At least one debate field must be provided",
  })

export const listDebateJobsInputSchema = z.object({
  limit: z.coerce.number().int().positive().max(200).default(100),
})

const debateJobSummarySchema = z.object({
  debateJobId: z.uuid(),
  ideaJobId: z.uuid(),
  title: z.string().min(1),
  slug: z.string().min(1),
  prompt: z.string().min(1),
  isPublic: z.boolean(),
  stage: z.enum(debateJobStages),
  status: z.enum(jobStatuses),
  stopRequested: z.boolean(),
  error: z.string().nullable(),
  createdAt: z.iso.datetime(),
  completedAt: z.iso.datetime().nullable(),
})

export const listDebateJobsResponseSchema = z.object({
  debateJobs: z.array(debateJobSummarySchema),
})

export const judgeVerdictSchema = z.object({
  winner: z
    .enum(["candidate_a", "candidate_b"])
    .describe(
      "candidate_a selects <candidate_a>; candidate_b selects <candidate_b>",
    ),
  explanation: z.string().trim().min(1),
})

const legacyJudgeVerdictSchema = z.object({
  winnerSlot: z.number().int().min(0).max(1),
  explanation: z.string().trim().min(1),
})

export const persistedJudgeVerdictSchema = z.union([
  judgeVerdictSchema,
  legacyJudgeVerdictSchema,
])

export type DebateJobEvent =
  | { type: "updated" }
  | { type: "error"; message: string }
  | { type: "done" }

export type LiveDebateJob = ReplayableEventLog<DebateJobEvent>
