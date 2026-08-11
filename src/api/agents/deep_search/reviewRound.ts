import z from "zod"
import { generateObjectStream } from "../../llms/generateText.ts"
import { PromptName } from "../../llms/prompts.ts"
import {
  awaitGenerationOutput,
  type GenerationOutcome,
  type TextStreamPersistenceTransaction,
} from "../../llms/streams.ts"
import { formatSearchSummaryContext } from "./searchSummaryContext.ts"

export const roundReviewSchema = z.object({
  decision: z.enum(["continue", "stop"]),
  reason: z.string().trim().min(1).max(2_000),
})

export type RoundReview = z.infer<typeof roundReviewSchema>

type SearchSummary = {
  round: number
  query: string
  content: string
}

type StartRoundReviewInput = {
  userId: string
  deepSearchJobId: string
  researchRequest: string
  completedRound: number
  maxRounds: number
  searchSummaries: SearchSummary[]
  onCompleted?: (
    completed: { id: string; output: RoundReview },
    transaction: TextStreamPersistenceTransaction,
  ) => void
  onRegistered?: (
    streamId: string,
    transaction: TextStreamPersistenceTransaction,
  ) => void
}

export type StartedRoundReview = {
  streamId: string
  review: Promise<RoundReview>
  completion: Promise<GenerationOutcome>
}

/** Starts the optional post-round quality review and retains its LLM stream. */
export async function startRoundReview(
  input: StartRoundReviewInput,
): Promise<StartedRoundReview> {
  const summaries = formatSearchSummaryContext(input.searchSummaries)
  const generation = await generateObjectStream({
    userId: input.userId,
    owner: { deepSearchJobId: input.deepSearchJobId },
    prompt: [
      "<user_request>",
      input.researchRequest,
      "</user_request>",
      `completed_rounds: ${input.completedRound + 1}`,
      `maximum_rounds: ${input.maxRounds}`,
      "<search_summaries>",
      summaries,
      "</search_summaries>",
    ].join("\n"),
    promptName: PromptName.ReviewDeepSearchRound,
    schema: roundReviewSchema,
    reasoning: "enabled",
    maxOutputTokens: 1_024,
    onCompleted: input.onCompleted,
    onRegistered: input.onRegistered,
  })

  return {
    streamId: generation.id,
    review: awaitGenerationOutput(generation, generation.output),
    completion: generation.completion,
  }
}
