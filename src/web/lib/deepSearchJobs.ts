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
  z.object({
    type: z.literal("query-stream"),
    round: z.number().int().nonnegative(),
    streamId: z.string().min(1),
  }),
  z.object({
    type: z.literal("search-results"),
    round: z.number().int().nonnegative(),
    searches: z.array(deepSearchResultsSchema),
  }),
  z.object({
    type: z.literal("selection-stream"),
    round: z.number().int().nonnegative(),
    query: z.string(),
    streamId: z.string().min(1),
  }),
  z.object({
    type: z.literal("selected-search-results"),
    round: z.number().int().nonnegative(),
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
    round: z.number().int().nonnegative(),
    query: z.string(),
    streamId: z.string().min(1),
  }),
  z.object({
    type: z.literal("round-answer-stream"),
    round: z.number().int().nonnegative(),
    streamId: z.string().min(1),
  }),
  z.object({
    type: z.literal("round-review-stream"),
    round: z.number().int().nonnegative(),
    streamId: z.string().min(1),
  }),
  z.object({
    type: z.literal("round-review"),
    round: z.number().int().nonnegative(),
    decision: z.enum(["continue", "stop"]),
    reason: z.string().min(1),
  }),
  z.object({
    type: z.literal("round-review-error"),
    round: z.number().int().nonnegative(),
    message: z.string().min(1),
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
  maxRounds?: number
}

const deepSearchJobSchema = z.object({
  deepSearchJobId: z.string().min(1),
  title: z.string().min(1),
  slug: z.string().min(1),
  researchRequest: z.string(),
  maxSearches: z.number().int().positive(),
  maxResultsPerSearch: z.number().int().positive(),
  maxRounds: z.number().int().positive(),
  status: z.enum(["running", "completed", "failed", "interrupted"]),
  error: z.string().nullable(),
  createdAt: z.iso.datetime().transform((value) => new Date(value)),
  completedAt: z.iso.datetime().transform((value) => new Date(value)).nullable(),
})

const deepSearchJobOriginSchema = z.object({
  kind: z.enum(["idea", "debate"]),
  title: z.string().min(1),
  slug: z.string().min(1),
})

const deepSearchJobListItemSchema = deepSearchJobSchema.extend({
  origin: deepSearchJobOriginSchema.nullable(),
})

const createDeepSearchJobResponseSchema = z.object({
  deepSearchJobId: z.string().min(1),
  slug: z.string().min(1),
})
const deepSearchJobsResponseSchema = z.object({
  deepSearchJobs: z.array(deepSearchJobListItemSchema),
})
const deepSearchJobResponseSchema = z.object({
  deepSearchJob: deepSearchJobSchema,
})

export type DeepSearchJob = z.infer<typeof deepSearchJobSchema>
export type DeepSearchJobOrigin = z.infer<typeof deepSearchJobOriginSchema>
export type DeepSearchJobListItem = z.infer<typeof deepSearchJobListItemSchema>
export type DeepSearchJobSource = "manual" | "automated"

export async function createDeepSearchJob(
  input: CreateDeepSearchJobInput,
  signal?: AbortSignal,
): Promise<z.infer<typeof createDeepSearchJobResponseSchema>> {
  const response = await postJson(
    "/api/deep-search-jobs",
    input,
    createDeepSearchJobResponseSchema,
    signal,
  )
  return response
}

export async function getDeepSearchJobs(
  source: DeepSearchJobSource,
  signal?: AbortSignal,
): Promise<DeepSearchJobListItem[]> {
  const response = await getJson(
    `/api/deep-search-jobs?source=${source}`,
    deepSearchJobsResponseSchema,
    signal,
  )
  return response.deepSearchJobs
}

export async function getDeepSearchJob(
  slug: string,
  signal?: AbortSignal,
): Promise<DeepSearchJob> {
  const response = await getJson(
    `/api/deep-search-jobs/${encodeURIComponent(slug)}`,
    deepSearchJobResponseSchema,
    signal,
  )
  return response.deepSearchJob
}

export async function* subscribeToDeepSearchJob(
  deepSearchJobId: string,
  signal?: AbortSignal,
  onOpen?: () => void,
): AsyncGenerator<DeepSearchJobEvent> {
  yield* subscribeToNdjson(
    `/api/deep-search-jobs/${encodeURIComponent(deepSearchJobId)}/events`,
    deepSearchJobEventSchema,
    signal,
    onOpen,
  )
}
