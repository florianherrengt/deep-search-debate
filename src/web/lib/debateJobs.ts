import z from "zod"
import { getJson, patchJson, postJson, subscribeToNdjson } from "./api.ts"

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
  title: z.string().min(1),
  slug: z.string().min(1),
  prompt: z.string().min(1),
  isPublic: z.boolean(),
  isOwner: z.boolean(),
  stopRequested: z.boolean(),
  canStop: z.boolean(),
  stage: z.enum(["ideas", "swiss", "semifinal", "final"]),
  status: z.enum(["running", "completed", "failed", "interrupted"]),
  expectedMatchCount: z.number().int().positive().nullable(),
  rounds: z.array(debateRoundSchema),
  standings: z.array(debateStandingSchema),
  error: z.string().nullable(),
})

const debateJobSummarySchema = z.object({
  debateJobId: z.string().min(1),
  ideaJobId: z.string().min(1),
  title: z.string().min(1),
  slug: z.string().min(1),
  prompt: z.string().min(1),
  isPublic: z.boolean(),
  stage: debateTournamentSchema.shape.stage,
  status: debateTournamentSchema.shape.status,
  stopRequested: z.boolean(),
  error: z.string().nullable(),
  createdAt: z.iso.datetime().transform((value) => new Date(value)),
  completedAt: z.iso.datetime().transform((value) => new Date(value)).nullable(),
})

const debateJobEventSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("updated") }),
  z.object({ type: z.literal("error"), message: z.string() }),
  z.object({ type: z.literal("done") }),
])

const createDebateJobResponseSchema = z.object({
  debateJobId: z.string().min(1),
  slug: z.string().min(1),
})

const debateJobResponseSchema = z.object({
  debateJob: debateTournamentSchema,
})
const debateJobsResponseSchema = z.object({
  debateJobs: z.array(debateJobSummarySchema),
})
const mutableDebateJobFieldsSchema = z.object({
  isPublic: z.boolean(),
})
const updateDebateJobInputSchema = mutableDebateJobFieldsSchema
  .partial()
  .refine((update) => Object.keys(update).length > 0, {
    message: "At least one debate field must be provided",
  })

export type DebateTournamentSnapshot = z.output<typeof debateTournamentSchema>
export type DebateJobEvent = z.output<typeof debateJobEventSchema>
export type DebateJobSummary = z.output<typeof debateJobSummarySchema>
export type CreateDebateJobInput = {
  prompt: string
  isPublic: boolean
  numberOfIdeas?: number
  deepSearchCount?: number
  maxSearches?: number
  maxResultsPerSearch?: number
  maxRounds?: number
}
export type UpdateDebateJobInput = z.input<typeof updateDebateJobInputSchema>
export type UpdatedDebateJob = z.output<typeof mutableDebateJobFieldsSchema>

export async function createDebateJob(
  input: CreateDebateJobInput,
  signal?: AbortSignal,
): Promise<z.infer<typeof createDebateJobResponseSchema>> {
  const response = await postJson(
    "/api/debate-jobs",
    input,
    createDebateJobResponseSchema,
    signal,
  )
  return response
}

export async function updateDebateJob(
  debateJobId: string,
  update: UpdateDebateJobInput,
  signal?: AbortSignal,
): Promise<UpdatedDebateJob> {
  const input = updateDebateJobInputSchema.parse(update)
  const response = await patchJson(
    `/api/debate-jobs/${encodeURIComponent(debateJobId)}`,
    input,
    mutableDebateJobFieldsSchema,
    signal,
  )
  return response
}

export async function getDebateJob(
  slug: string,
  signal?: AbortSignal,
): Promise<DebateTournamentSnapshot> {
  const response = await getJson(
    `/api/debate-jobs/${encodeURIComponent(slug)}`,
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
