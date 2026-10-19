import z from "zod"
import { getJson, postJson, putJson } from "../../lib/api.ts"

const refineAnswerSchema = z.object({
  questionId: z.string().min(1),
  selectedCandidateIds: z.array(z.string().min(1)),
  text: z.string(),
  unanswered: z.boolean().optional(),
})

const refineQuestionSchema = z.object({
  id: z.string().min(1),
  prompt: z.string().min(1),
  candidates: z.array(z.object({ id: z.string().min(1), label: z.string().min(1) })),
})

const refineBatchSchema = z.object({
  id: z.string().min(1),
  status: z.enum(["preparing", "ready", "failed", "submitted"]),
  questions: z.array(refineQuestionSchema),
  answers: z.array(refineAnswerSchema).optional(),
})

const refineSearchSchema = z.object({
  deepSearchJobId: z.string().min(1),
  title: z.string().min(1),
  status: z.enum(["running", "completed", "failed", "interrupted"]),
  slug: z.string().min(1),
})

const refineSessionSchema = z.object({
  id: z.string().min(1),
  originalPrompt: z.string(),
  status: z.enum(["clarifying", "starting", "research-started"]),
  prepState: z.enum(["idle", "preparing", "failed"]),
  pendingBatchId: z.string().min(1).nullable(),
  currentBatchId: z.string().min(1).nullable(),
  batches: z.array(refineBatchSchema),
  draftAnswers: z.array(refineAnswerSchema),
  prepSearches: z.array(refineSearchSchema),
  research: z.object({ deepSearchJobId: z.string().min(1), slug: z.string().min(1) }).nullable().optional(),
  createdAt: z.iso.datetime().transform((value) => new Date(value)),
  updatedAt: z.iso.datetime().transform((value) => new Date(value)),
})

const refineSessionResponseSchema = z.object({ refineSession: refineSessionSchema })
const refineSessionListResponseSchema = z.object({
  refineSessions: z.array(z.object({
    id: z.string().min(1),
    originalPrompt: z.string(),
    status: z.enum(["clarifying", "starting", "research-started"]),
    updatedAt: z.iso.datetime().transform((value) => new Date(value)),
    createdAt: z.iso.datetime().transform((value) => new Date(value)),
    research: z.object({ deepSearchJobId: z.string().min(1), slug: z.string().min(1) }).nullable().optional(),
  })),
})

export type RefineAnswer = z.infer<typeof refineAnswerSchema>
export type RefineSession = z.infer<typeof refineSessionSchema>
export type RefineSessionSummary = z.infer<typeof refineSessionListResponseSchema>["refineSessions"][number]

const answersSchema = z.array(z.object({
  questionId: z.string().min(1),
  selectedCandidateIds: z.array(z.string().min(1)),
  text: z.string(),
}))

export async function getRefineSessions(signal?: AbortSignal): Promise<RefineSessionSummary[]> {
  const response = await getJson("/api/refine-sessions", refineSessionListResponseSchema, signal)
  return response.refineSessions
}

export async function getRefineSession(id: string, signal?: AbortSignal): Promise<RefineSession> {
  const response = await getJson(`/api/refine-sessions/${encodeURIComponent(id)}`, refineSessionResponseSchema, signal)
  return response.refineSession
}

export async function createRefineSession(prompt: string, signal?: AbortSignal): Promise<RefineSession> {
  const response = await postJson("/api/refine-sessions", { prompt }, refineSessionResponseSchema, signal)
  return response.refineSession
}

export async function saveRefineDraft(
  id: string,
  batchId: string,
  answers: RefineAnswer[],
  signal?: AbortSignal,
): Promise<RefineSession> {
  const response = await putJson(
    `/api/refine-sessions/${encodeURIComponent(id)}/draft`,
    { batchId, answers: answersSchema.parse(answers) },
    refineSessionResponseSchema,
    signal,
  )
  return response.refineSession
}

export async function submitRefineAnswers(
  id: string,
  batchId: string,
  answers: RefineAnswer[],
  signal?: AbortSignal,
): Promise<RefineSession> {
  const response = await postJson(
    `/api/refine-sessions/${encodeURIComponent(id)}/batches`,
    { batchId, answers: answersSchema.parse(answers) },
    refineSessionResponseSchema,
    signal,
  )
  return response.refineSession
}

export async function retryRefinePreparation(id: string, batchId: string, signal?: AbortSignal): Promise<RefineSession> {
  const response = await postJson(
    `/api/refine-sessions/${encodeURIComponent(id)}/retry`,
    { batchId },
    refineSessionResponseSchema,
    signal,
  )
  return response.refineSession
}

export async function startRefineResearch(
  id: string,
  batchId: string,
  answers: RefineAnswer[],
  signal?: AbortSignal,
): Promise<RefineSession> {
  const response = await postJson(
    `/api/refine-sessions/${encodeURIComponent(id)}/research`,
    { batchId, answers: answersSchema.parse(answers) },
    refineSessionResponseSchema,
    signal,
  )
  return response.refineSession
}
