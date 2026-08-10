import z from "zod"
import { getJson, postJson, subscribeToNdjson } from "./api.ts"

const ideaSchema = z.object({
  ideaId: z.string().min(1),
  title: z.string().min(1),
  description: z.string().min(1),
})

const ideaJobStageSchema = z.enum([
  "planning",
  "research",
  "summary",
  "ideas",
])
const ideaEventStageSchema = z.union([
  ideaJobStageSchema,
  z.literal("critique"),
  z.literal("selection"),
  z.literal("refinement"),
  z.literal("idea-research"),
])

const ideaJobEventSchema = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("research-prompt-stream"),
    streamId: z.string().min(1),
  }),
  z.object({
    type: z.literal("deep-search-started"),
    deepSearchJobId: z.string().min(1),
    title: z.string().min(1),
    slug: z.string().min(1),
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
    type: z.literal("critique-generation-stream"),
    position: z.number().int().nonnegative(),
    streamId: z.string().min(1),
  }),
  z.object({
    type: z.literal("idea-selection-stream"),
    streamId: z.string().min(1),
  }),
  z.object({
    type: z.literal("selected-ideas"),
    selectedIdeaIds: z
      .array(z.string().min(1))
      .min(6)
      .max(100)
      .refine((ids) => ids.length % 2 === 0)
      .refine((ids) => new Set(ids).size === ids.length),
  }),
  z.object({
    type: z.literal("idea-refinement-stream"),
    ideaId: z.string().min(1),
    streamId: z.string().min(1),
  }),
  z.object({ type: z.literal("refined-idea"), ...ideaSchema.shape }),
  z.object({
    type: z.literal("idea-deep-search-started"),
    ideaId: z.string().min(1),
    deepSearchJobId: z.string().min(1),
    title: z.string().min(1),
    slug: z.string().min(1),
    researchRequest: z.string().min(1),
  }),
  z.object({
    type: z.literal("error"),
    message: z.string(),
    stage: ideaEventStageSchema,
  }),
  z.object({ type: z.literal("done") }),
])

const ideaJobSchema = z.object({
  ideaJobId: z.string().min(1),
  title: z.string().min(1),
  slug: z.string().min(1),
  prompt: z.string(),
  stage: ideaJobStageSchema,
  numberOfIdeas: z.number().int().positive(),
  deepSearchCount: z.number().int().positive(),
  status: z.enum(["running", "completed", "failed", "interrupted"]),
  error: z.string().nullable(),
  createdAt: z.iso.datetime().transform((value) => new Date(value)),
  completedAt: z.iso.datetime().transform((value) => new Date(value)).nullable(),
})

const createIdeaJobResponseSchema = z.object({
  ideaJobId: z.string().min(1),
  slug: z.string().min(1),
})
const ideaJobsResponseSchema = z.object({ ideaJobs: z.array(ideaJobSchema) })
const ideaJobResponseSchema = z.object({ ideaJob: ideaJobSchema })

export type Idea = z.infer<typeof ideaSchema>
export type IdeaStage = z.infer<typeof ideaEventStageSchema>
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
): Promise<z.infer<typeof createIdeaJobResponseSchema>> {
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
  return response
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
  slug: string,
  signal?: AbortSignal,
): Promise<IdeaJob> {
  const response = await getJson(
    `/api/idea-jobs/${encodeURIComponent(slug)}`,
    ideaJobResponseSchema,
    signal,
  )
  return response.ideaJob
}

export async function* subscribeToIdeaJob(
  ideaJobId: string,
  signal?: AbortSignal,
  onOpen?: () => void,
): AsyncGenerator<IdeaJobEvent> {
  yield* subscribeToNdjson(
    `/api/idea-jobs/${encodeURIComponent(ideaJobId)}/events`,
    ideaJobEventSchema,
    signal,
    onOpen,
  )
}
