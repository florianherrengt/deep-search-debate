import z from "zod"

export const webSearchResultsSchema = z.array(
  z.object({
    title: z.string().trim().min(1),
    shortText: z.string().trim().min(1),
    link: z.url(),
  }),
)

export type WebSearchResult = z.infer<typeof webSearchResultsSchema>[number]
