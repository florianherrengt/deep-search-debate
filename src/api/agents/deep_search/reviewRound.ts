import z from "zod"
import { researchAnalysisSchema, researchRequirementsSchema, type ResearchRequirements } from "./schemas.ts"
import { generateObjectStream } from "../../llms/generateText.ts"
import { PromptName } from "../../llms/prompts.ts"
import {
  awaitGenerationOutput,
  type GenerationOutcome,
  type TextGenerationPersistenceCallbacks,
  type TextStreamPersistenceTransaction,
} from "../../llms/streams.ts"
import {
  formatSearchSummaryContext,
  type SourceEvidence,
} from "./searchSummaryContext.ts"

const legacyRoundReviewSchema = z.object({
  version: z.never().optional(),
  decision: z.enum(["continue", "stop"]),
  reason: z.string().trim().min(1).max(2_000),
  requirements: researchRequirementsSchema.optional(),
})

// Version 1 replaces the model's stop/continue vote with evidence gaps. Older
// persisted reviews retain their recorded decision rather than being rejudged.
const gapReviewSchema = z.object({
  version: z.literal(1),
  requirements: researchRequirementsSchema,
  gaps: researchAnalysisSchema.shape.gaps.element.extend({
    evidenceToFind: z.string().trim().min(1).max(500).nullable(),
  }).array().max(12),
  reason: z.string().trim().min(1).max(2_000),
})

export const roundReviewSchema = z.union([gapReviewSchema, legacyRoundReviewSchema])

export type RoundReview = {
  decision: "continue" | "stop"
  reason: string
  requirements?: ResearchRequirements
}

/** Derives control flow from validated gaps, never from the model's prose. */
export function parseRoundReview(value: unknown): RoundReview {
  const review = roundReviewSchema.parse(value)
  if (review.version !== 1) {
    return review
  }
  const searchableGaps = review.gaps.filter((gap) => gap.evidenceToFind !== null)
  return {
    decision: searchableGaps.length > 0 ? "continue" : "stop",
    reason: searchableGaps.length > 0
      ? ["Further research is needed.", ...searchableGaps.map((gap) =>
          `${gap.title}: ${gap.description}\nEvidence to find: ${gap.evidenceToFind}`,
        )].join("\n\n")
      : review.reason,
    requirements: review.requirements,
  }
}

type SearchSummary = {
  round: number
  query: string
  content: string
}

type StartRoundReviewInput = {
  userId: string
  deepSearchJobId: string
  researchRequest: string
  candidateAnswer: string
  completedRound: number
  maxRounds: number
  searchSummaries: SearchSummary[]
  sourceEvidence?: SourceEvidence[]
  requirements?: ResearchRequirements
  workflowSignal?: AbortSignal
  onCompleted?: (
    completed: { id: string; output: RoundReview },
    transaction: TextStreamPersistenceTransaction,
  ) => void
  onRegistered?: (
    streamId: string,
    transaction: TextStreamPersistenceTransaction,
  ) => void
  onInterrupted?: TextGenerationPersistenceCallbacks["onInterrupted"]
}

export type StartedRoundReview = {
  streamId: string
  review: Promise<RoundReview>
  completion: Promise<GenerationOutcome>
}

/** Audits the candidate's evidence gaps before deciding whether research ends. */
export async function startRoundReview(
  input: StartRoundReviewInput,
): Promise<StartedRoundReview> {
  const summaries = formatSearchSummaryContext(
    input.searchSummaries,
    undefined,
    input.sourceEvidence,
    input.researchRequest,
  )
  const generation = await generateObjectStream({
    userId: input.userId,
    owner: { deepSearchJobId: input.deepSearchJobId },
    prompt: [
      "<user_request>",
      input.researchRequest,
      "</user_request>",
      "<requirements>", JSON.stringify(input.requirements ?? []), "</requirements>",
      "<candidate_answer>",
      input.candidateAnswer,
      "</candidate_answer>",
      `completed_rounds: ${input.completedRound + 1}`,
      `maximum_rounds: ${input.maxRounds}`,
      "<search_summaries>",
      summaries,
      "</search_summaries>",
    ].join("\n"),
    promptName: PromptName.ReviewDeepSearchRound,
    schema: gapReviewSchema,
    reasoning: "enabled",
    workflowSignal: input.workflowSignal,
    onCompleted: (completed, transaction) => {
      input.onCompleted?.({ id: completed.id, output: parseRoundReview(completed.output) }, transaction)
    },
    onRegistered: input.onRegistered,
    onInterrupted: input.onInterrupted,
  })

  return {
    streamId: generation.id,
    review: awaitGenerationOutput(generation, generation.output).then(parseRoundReview),
    completion: generation.completion,
  }
}
