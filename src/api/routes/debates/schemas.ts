import z from "zod"

import type { ReplayableEventLog } from "../../helpers/replayableEventLog.ts"
import { debateJobStages, jobStatuses } from "../../db/schema/index.ts"

export const createDebateJobInputSchema = z.object({
  prompt: z.string().trim().min(1),
  isPublic: z.boolean().default(false),
})

export const debateJobParamsSchema = z.object({ debateJobId: z.uuid() })

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
