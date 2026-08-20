import z from "zod"
import { patchJson } from "./api.ts"

export const resultFeedbackSchema = z.object({
  rating: z.boolean().nullable(),
  hasWrittenFeedback: z.boolean(),
})

const resultFeedbackResponseSchema = z.object({
  feedback: resultFeedbackSchema,
})

const resultFeedbackInputSchema = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("rating"),
    rating: z.boolean(),
  }),
  z.object({
    type: z.literal("text"),
    text: z.string().trim().min(1).max(5_000),
  }),
])

export type ResultFeedback = z.output<typeof resultFeedbackSchema>
export type ResultFeedbackInput = z.input<typeof resultFeedbackInputSchema>
export type FeedbackResource = "deep-search" | "idea" | "debate"

const feedbackResourcePaths: Record<FeedbackResource, string> = {
  "deep-search": "deep-search-jobs",
  idea: "idea-jobs",
  debate: "debate-jobs",
}

export async function updateResultFeedback(
  resource: FeedbackResource,
  jobId: string,
  input: ResultFeedbackInput,
  signal?: AbortSignal,
): Promise<ResultFeedback> {
  const body = resultFeedbackInputSchema.parse(input)
  const response = await patchJson(
    `/api/${feedbackResourcePaths[resource]}/${encodeURIComponent(jobId)}/feedback`,
    body,
    resultFeedbackResponseSchema,
    signal,
  )
  return response.feedback
}
