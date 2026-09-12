import z from "zod"
import { generateObjectStream } from "../../llms/generateText.ts"
import { researchPlanSchema, type ResearchRequirements } from "./schemas.ts"
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

type GenerateWebSearchQueriesInput = Pick<
  TextGenerationPersistenceCallbacks,
  "onRegistered" | "onFailed" | "onInterrupted"
> & {
  userId: string
  deepSearchJobId: string
  researchRequest: string
  maxSearches: number
  round?: number
  previousQueries?: string[]
  previousSearchSummaries?: {
    round?: number
    query: string
    content: string
  }[]
  previousCandidateAnswer?: string
  sourceEvidence?: SourceEvidence[]
  previousReviewReason?: string
  requirements?: ResearchRequirements
  workflowSignal?: AbortSignal
  onCompleted?: (
    completed: { id: string; output: string[] },
    transaction: TextStreamPersistenceTransaction,
  ) => void
}

export type QueryGeneration = {
  streamId: string
  queries: Promise<string[]>
  completion: Promise<GenerationOutcome>
}

/**
 * Registers query generation and exposes its stream, durable completion, and
 * validated ordered result separately.
 */
export async function generateWebSearchQueries(
  params: GenerateWebSearchQueriesInput,
): Promise<QueryGeneration> {
  const round = params.round ?? 0
  const previousQueries = params.previousQueries ?? []
  const previousSearchSummaries = params.previousSearchSummaries ?? []
  const previousResearch = formatSearchSummaryContext(
    previousSearchSummaries,
    undefined,
    params.sourceEvidence,
    params.researchRequest,
  )
  const priorQueries = new Set(previousQueries.map((query) => query.trim().toLocaleLowerCase()))
  const schema = researchPlanSchema.extend({
    queries: z.array(z.string().trim().min(1).max(500)).length(params.maxSearches)
      .refine((queries) => new Set(queries.map((query) => query.toLocaleLowerCase())).size === queries.length,
        "Search queries must be distinct")
      .refine((queries) => queries.every((query) => !priorQueries.has(query.toLocaleLowerCase())),
        "Search queries must not repeat completed queries"),
  })
  const generation = await generateObjectStream({
    userId: params.userId,
    owner: { deepSearchJobId: params.deepSearchJobId },
    prompt: [
      "<research_request>",
      params.researchRequest,
      "</research_request>",
      "<requirements>", JSON.stringify(params.requirements ?? []), "</requirements>",
      "<previous_queries>", JSON.stringify(previousQueries), "</previous_queries>",
      ...(previousResearch
        ? [
            "<previous_search_summaries>",
            previousResearch,
            "</previous_search_summaries>",
          ]
        : []),
      ...(params.previousCandidateAnswer
        ? [
            "<previous_candidate_answer>",
            params.previousCandidateAnswer,
            "</previous_candidate_answer>",
          ]
        : []),
      ...(params.previousReviewReason
        ? [
            "<previous_review_reason>",
            params.previousReviewReason,
            "</previous_review_reason>",
          ]
        : []),
      `Generate exactly ${params.maxSearches} ${round === 0 ? "" : "new "}search queries.`,
    ].join("\n"),
    promptName: PromptName.GenerateWebSearchQueries,
    schema,
    workflowSignal: params.workflowSignal,
    ...(params.onRegistered ? { onRegistered: params.onRegistered } : {}),
    ...(params.onFailed ? { onFailed: params.onFailed } : {}),
    ...(params.onInterrupted
      ? { onInterrupted: params.onInterrupted }
      : {}),
    ...(params.onCompleted
      ? {
          onCompleted: (
            completed: { id: string; output: z.infer<typeof researchPlanSchema> },
            transaction: TextStreamPersistenceTransaction,
          ) => {
            params.onCompleted?.(
              {
                id: completed.id,
                output: completed.output.queries,
              },
              transaction,
            )
          },
        }
      : {}),
  })

  const queries = awaitGenerationOutput(generation, generation.output).then(
    (output) => output.queries,
  )

  return {
    streamId: generation.id,
    queries,
    completion: generation.completion,
  }
}
