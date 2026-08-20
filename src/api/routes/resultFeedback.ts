import z from "zod"

export const resultFeedbackInputSchema = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("rating"),
    rating: z.boolean(),
  }),
  z.object({
    type: z.literal("text"),
    text: z
      .string()
      .max(5_000)
      .refine((text) => text.trim().length > 0, {
        message: "Written feedback cannot be empty",
      }),
  }),
])

export type ResultFeedbackInput = z.infer<typeof resultFeedbackInputSchema>

type JobStatus = "running" | "completed" | "failed" | "interrupted"

type FeedbackRow = {
  feedbackRating: boolean | null
  feedbackText: string | null
}

type FeedbackCommands = {
  getOwnerStatus(): JobStatus | undefined
  updateRating(rating: boolean): FeedbackRow | undefined
  updateText(text: string): FeedbackRow | undefined
}

export type ResultFeedback = {
  rating: boolean | null
  hasWrittenFeedback: boolean
}

type ResultFeedbackUpdateResult =
  | { kind: "updated"; feedback: ResultFeedback }
  | { kind: "not-found" }
  | { kind: "not-completed" }
  | { kind: "negative-rating-required" }

export function resultFeedbackProjection(
  feedbackRating: boolean | null,
  feedbackText: string | null,
): ResultFeedback {
  return {
    rating: feedbackRating,
    hasWrittenFeedback: feedbackText !== null,
  }
}

/** Applies the shared feedback state machine around aggregate-specific SQL. */
export function updateResultFeedback(
  input: ResultFeedbackInput,
  commands: FeedbackCommands,
): ResultFeedbackUpdateResult {
  const updated =
    input.type === "rating"
      ? commands.updateRating(input.rating)
      : commands.updateText(input.text)
  if (!updated) {
    const ownerStatus = commands.getOwnerStatus()
    if (!ownerStatus) return { kind: "not-found" }
    if (ownerStatus !== "completed") return { kind: "not-completed" }
    return { kind: "negative-rating-required" }
  }

  return {
    kind: "updated",
    feedback: resultFeedbackProjection(
      updated.feedbackRating,
      updated.feedbackText,
    ),
  }
}
