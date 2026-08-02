import z from "zod"
import { getJson, postJson, subscribeToNdjson } from "./api.ts"

const deepSearchResultSchema = z.object({
  title: z.string(),
  shortText: z.string(),
  link: z.url(),
})

const deepSearchResultsSchema = z.object({
  query: z.string(),
  results: z.array(deepSearchResultSchema),
})

export type DeepSearchResults = z.infer<typeof deepSearchResultsSchema>

const deepSearchJobEventSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("query-stream"), streamId: z.string().min(1) }),
  z.object({
    type: z.literal("search-results"),
    searches: z.array(deepSearchResultsSchema),
  }),
  z.object({
    type: z.literal("selection-stream"),
    query: z.string(),
    streamId: z.string().min(1),
  }),
  z.object({
    type: z.literal("selected-search-results"),
    query: z.string(),
    selectedLinks: z.array(z.url()),
  }),
  z.object({
    type: z.literal("page-summary-stream"),
    url: z.url(),
    streamId: z.string().min(1),
  }),
  z.object({
    type: z.literal("page-summary-error"),
    url: z.url(),
    stage: z.enum(["extraction", "summary"]),
    message: z.string(),
  }),
  z.object({
    type: z.literal("query-summary-stream"),
    query: z.string(),
    streamId: z.string().min(1),
  }),
  z.object({
    type: z.literal("final-answer-stream"),
    streamId: z.string().min(1),
  }),
  z.object({ type: z.literal("error"), message: z.string() }),
  z.object({ type: z.literal("done") }),
])

export type DeepSearchJobEvent = z.infer<typeof deepSearchJobEventSchema>

type CreateDeepSearchJobInput = {
  researchRequest: string
  maxSearches?: number
  maxResultsPerSearch?: number
}

const deepSearchJobSchema = z.object({
  deepSearchJobId: z.string().min(1),
  researchRequest: z.string(),
  maxSearches: z.number().int().positive(),
  maxResultsPerSearch: z.number().int().positive(),
  status: z.enum(["running", "completed", "failed", "interrupted"]),
  error: z.string().nullable(),
  createdAt: z.string(),
  completedAt: z.string().nullable(),
})

const createDeepSearchJobResponseSchema = z.object({
  deepSearchJobId: z.string().min(1),
})
const deepSearchJobsResponseSchema = z.object({
  deepSearchJobs: z.array(deepSearchJobSchema),
})
const deepSearchJobResponseSchema = z.object({
  deepSearchJob: deepSearchJobSchema,
})

export type DeepSearchJob = z.infer<typeof deepSearchJobSchema>

export async function createDeepSearchJob(
  input: CreateDeepSearchJobInput,
  signal?: AbortSignal,
): Promise<string> {
  const url = "/api/deep-search-jobs"
  const response = await postJson(
    url,
    {
      researchRequest: input.researchRequest,
      maxSearches: input.maxSearches ?? 3,
      maxResultsPerSearch: input.maxResultsPerSearch ?? 3,
    },
    createDeepSearchJobResponseSchema,
    signal,
  )
  return response.deepSearchJobId
}

export async function getDeepSearchJobs(
  signal?: AbortSignal,
): Promise<DeepSearchJob[]> {
  const response = await getJson(
    "/api/deep-search-jobs",
    deepSearchJobsResponseSchema,
    signal,
  )
  return response.deepSearchJobs
}

export async function getDeepSearchJob(
  deepSearchJobId: string,
  signal?: AbortSignal,
): Promise<DeepSearchJob> {
  const response = await getJson(
    `/api/deep-search-jobs/${encodeURIComponent(deepSearchJobId)}`,
    deepSearchJobResponseSchema,
    signal,
  )
  return response.deepSearchJob
}

export async function* subscribeToDeepSearchJob(
  deepSearchJobId: string,
  signal?: AbortSignal,
): AsyncGenerator<DeepSearchJobEvent> {
  yield* subscribeToNdjson(
    `/api/deep-search-jobs/${encodeURIComponent(deepSearchJobId)}/events`,
    deepSearchJobEventSchema,
    signal,
  )
}
