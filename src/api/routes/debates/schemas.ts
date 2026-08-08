import z from "zod"

import type { ReplayableEventLog } from "../../helpers/replayableEventLog.ts"
import { debateJobStages, jobStatuses } from "../../db/schema/index.ts"

export const createDebateJobInputSchema = z.object({
  prompt: z.string().trim().min(1),
})

export const debateJobEventParamsSchema = z.object({ debateJobId: z.uuid() })

export const debateJobParamsSchema = z.object({
  slug: z.string().trim().min(1).max(80),
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
