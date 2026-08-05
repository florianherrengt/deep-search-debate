import z from "zod"
import { getJson, postJson, subscribeToNdjson } from "./api.ts"

const debateIdeaSchema = z.object({
  ideaId: z.string().min(1),
  position: z.number().int().nonnegative(),
  title: z.string().min(1),
  description: z.string().min(1),
})

const debateMessageSchema = z.object({
  debateMessageId: z.string().min(1),
  position: z.number().int().nonnegative(),
  speakerSlot: z.union([z.literal(0), z.literal(1), z.literal(2)]),
  llmGenerationId: z.string().min(1),
  text: z.string(),
  createdAt: z.iso.datetime().transform((value) => new Date(value)),
})

const debateMatchSchema = z.object({
  debateMatchId: z.string().min(1),
  position: z.number().int().nonnegative(),
  firstIdea: debateIdeaSchema,
  secondIdea: debateIdeaSchema,
  winnerIdeaId: z.string().min(1).nullable(),
  status: z.enum(["pending", "running", "completed"]),
  messages: z.array(debateMessageSchema),
})

const debateRoundSchema = z.object({
  debateRoundId: z.string().min(1),
  stage: z.enum(["swiss", "semifinal", "final"]),
  stageRoundNumber: z.number().int().positive(),
  matches: z.array(debateMatchSchema),
})

const debateStandingSchema = z.object({
  idea: debateIdeaSchema,
  wins: z.number().int().nonnegative(),
  elo: z.number(),
})

const debateTournamentSchema = z.object({
  debateJobId: z.string().min(1),
  ideaJobId: z.string().min(1),
  prompt: z.string().min(1),
  stage: z.enum(["ideas", "swiss", "semifinal", "final"]),
  status: z.enum(["running", "completed", "failed", "interrupted"]),
  expectedMatchCount: z.number().int().positive(),
  rounds: z.array(debateRoundSchema),
  standings: z.array(debateStandingSchema),
  error: z.string().nullable(),
})

const debateJobSummarySchema = z.object({
  debateJobId: z.string().min(1),
  ideaJobId: z.string().min(1),
  prompt: z.string().min(1),
  stage: debateTournamentSchema.shape.stage,
  status: debateTournamentSchema.shape.status,
  error: z.string().nullable(),
  createdAt: z.iso.datetime(),
  completedAt: z.iso.datetime().nullable(),
})

const debateJobEventSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("updated") }),
  z.object({ type: z.literal("error"), message: z.string() }),
  z.object({ type: z.literal("done") }),
])

const createDebateJobResponseSchema = z.object({
  debateJobId: z.string().min(1),
})

const debateJobResponseSchema = z.object({
  debateJob: debateTournamentSchema,
})
const debateJobsResponseSchema = z.object({
  debateJobs: z.array(debateJobSummarySchema),
})

export type DebateTournamentSnapshot = z.output<typeof debateTournamentSchema>
export type DebateJobEvent = z.output<typeof debateJobEventSchema>
export type DebateJobSummary = z.output<typeof debateJobSummarySchema>

export async function createDebateJob(
  prompt: string,
  signal?: AbortSignal,
): Promise<string> {
  const response = await postJson(
    "/api/debate-jobs",
    { prompt },
    createDebateJobResponseSchema,
    signal,
  )
  return response.debateJobId
}

export async function getDebateJob(
  debateJobId: string,
  signal?: AbortSignal,
): Promise<DebateTournamentSnapshot> {
  const response = await getJson(
    `/api/debate-jobs/${encodeURIComponent(debateJobId)}`,
    debateJobResponseSchema,
    signal,
  )
  return response.debateJob
}

export async function getDebateJobs(
  signal?: AbortSignal,
): Promise<DebateJobSummary[]> {
  const response = await getJson(
    "/api/debate-jobs",
    debateJobsResponseSchema,
    signal,
  )
  return response.debateJobs
}

export async function* subscribeToDebateJob(
  debateJobId: string,
  signal?: AbortSignal,
  onOpen?: () => void,
): AsyncGenerator<DebateJobEvent> {
  yield* subscribeToNdjson(
    `/api/debate-jobs/${encodeURIComponent(debateJobId)}/events`,
    debateJobEventSchema,
    signal,
    onOpen,
  )
}
