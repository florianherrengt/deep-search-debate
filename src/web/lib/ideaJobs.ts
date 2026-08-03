import z from "zod"
import { getJson, postJson, subscribeToNdjson } from "./api.ts"

const ideaSchema = z.object({
  title: z.string().min(1),
  description: z.string().min(1),
})

const ideaStageSchema = z.enum(["planning", "research", "summary", "ideas"])

const ideaJobEventSchema = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("research-prompt-stream"),
    streamId: z.string().min(1),
  }),
  z.object({
    type: z.literal("deep-search-started"),
    deepSearchJobId: z.string().min(1),
    researchRequest: z.string().min(1),
  }),
  z.object({
    type: z.literal("research-summary-stream"),
    streamId: z.string().min(1),
  }),
  z.object({
    type: z.literal("idea-generation-stream"),
    streamId: z.string().min(1),
  }),
  z.object({ type: z.literal("idea"), ...ideaSchema.shape }),
  z.object({
    type: z.literal("error"),
    message: z.string(),
    stage: ideaStageSchema,
  }),
  z.object({ type: z.literal("done") }),
])

const ideaJobSchema = z.object({
  ideaJobId: z.string().min(1),
  prompt: z.string(),
  stage: ideaStageSchema,
  numberOfIdeas: z.number().int().positive(),
  deepSearchCount: z.number().int().positive(),
  status: z.enum(["running", "completed", "failed", "interrupted"]),
  error: z.string().nullable(),
  createdAt: z.string(),
  completedAt: z.string().nullable(),
})

const createIdeaJobResponseSchema = z.object({
  ideaJobId: z.string().min(1),
})
const ideaJobsResponseSchema = z.object({ ideaJobs: z.array(ideaJobSchema) })
const ideaJobResponseSchema = z.object({ ideaJob: ideaJobSchema })

export type Idea = z.infer<typeof ideaSchema>
export type IdeaStage = z.infer<typeof ideaStageSchema>
export type IdeaJobEvent = z.infer<typeof ideaJobEventSchema>
export type IdeaJob = z.infer<typeof ideaJobSchema>

export async function createIdeaJob(
  input: {
    prompt: string
    numberOfIdeas?: number
    deepSearchCount?: number
    maxSearches?: number
    maxResultsPerSearch?: number
  },
  signal?: AbortSignal,
): Promise<string> {
  const response = await postJson(
    "/api/idea-jobs",
    {
      prompt: input.prompt,
      numberOfIdeas: input.numberOfIdeas ?? 12,
      deepSearchCount: input.deepSearchCount ?? 2,
      maxSearches: input.maxSearches ?? 3,
      maxResultsPerSearch: input.maxResultsPerSearch ?? 3,
    },
    createIdeaJobResponseSchema,
    signal,
  )
  return response.ideaJobId
}

export async function getIdeaJobs(signal?: AbortSignal): Promise<IdeaJob[]> {
  const response = await getJson(
    "/api/idea-jobs",
    ideaJobsResponseSchema,
    signal,
  )
  return response.ideaJobs
}

export async function getIdeaJob(
  ideaJobId: string,
  signal?: AbortSignal,
): Promise<IdeaJob> {
  const response = await getJson(
    `/api/idea-jobs/${encodeURIComponent(ideaJobId)}`,
    ideaJobResponseSchema,
    signal,
  )
  return response.ideaJob
}

export async function* subscribeToIdeaJob(
  ideaJobId: string,
  signal?: AbortSignal,
): AsyncGenerator<IdeaJobEvent> {
  yield* subscribeToNdjson(
    `/api/idea-jobs/${encodeURIComponent(ideaJobId)}/events`,
    ideaJobEventSchema,
    signal,
  )
}
