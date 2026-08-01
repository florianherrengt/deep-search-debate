import z from "zod"

const searchResultSchema = z.object({
  title: z.string(),
  shortText: z.string(),
  link: z.string(),
})

export const deepSearchSearchSchema = z.object({
  query: z.string(),
  results: z.array(searchResultSchema),
})

export const deepSearchSearchResultsSchema = z.array(deepSearchSearchSchema)

const deepSearchEventSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("query-stream"), streamId: z.string() }),
  z.object({
    type: z.literal("search-results"),
    searches: deepSearchSearchResultsSchema,
  }),
  z.object({
    type: z.literal("selection-stream"),
    query: z.string(),
    streamId: z.string(),
  }),
  z.object({
    type: z.literal("selected-search-results"),
    query: z.string(),
    selectedLinks: z.array(z.string()),
  }),
  z.object({
    type: z.literal("page-summary-stream"),
    url: z.string(),
    streamId: z.string(),
  }),
  z.object({
    type: z.literal("page-summary-error"),
    url: z.string(),
    stage: z.enum(["extraction", "summary"]),
    message: z.string(),
  }),
  z.object({
    type: z.literal("query-summary-stream"),
    query: z.string(),
    streamId: z.string(),
  }),
])

export type DeepSearchEvent = z.infer<typeof deepSearchEventSchema>

const onEventSchema = z
  .function()
  .input(z.tuple([deepSearchEventSchema]))
  .output(z.void())

export const deepSearchInputSchema = z.object({
  researchRequest: z.string(),
  maxSearches: z.number().int().positive().default(3),
  maxResultsPerSearch: z.number().int().positive().default(3),
  onEvent: onEventSchema,
})
