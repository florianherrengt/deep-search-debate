import z from "zod"

import type { ReplayableEventLog } from "../../helpers/replayableEventLog.ts"
import { debateJobStages, jobStatuses } from "../../db/schema/index.ts"
import { createIdeaJobInputSchema } from "../ideas/schemas.ts"

export const createDebateJobInputSchema = createIdeaJobInputSchema.safeExtend({
  isPublic: z.boolean().default(false),
})

export type CreateDebateJobRequest = z.input<
  typeof createDebateJobInputSchema
>

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
  error: z.string().nullable(),
  createdAt: z.iso.datetime(),
  completedAt: z.iso.datetime().nullable(),
})

export const listDebateJobsResponseSchema = z.object({
  debateJobs: z.array(debateJobSummarySchema),
})

export const judgeVerdictSchema = z.object({
  winnerSlot: z.number().int().min(0).max(1),
  explanation: z.string().trim().min(1),
})

export type DebateJobEvent =
  | { type: "updated" }
  | { type: "error"; message: string }
  | { type: "done" }

export type LiveDebateJob = ReplayableEventLog<DebateJobEvent>
