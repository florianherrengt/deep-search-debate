import z from "zod"
import { generateArrayStream } from "../../llms/generateText.ts"
import { PromptName } from "../../llms/prompts.ts"
import {
  awaitGenerationOutput,
  type GenerationOutcome,
  type TextGenerationPersistenceCallbacks,
  type TextStreamPersistenceTransaction,
} from "../../llms/streams.ts"
import { formatSearchSummaryContext } from "./searchSummaryContext.ts"

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
  previousReviewReason?: string
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

function normalizeQueries(
  output: readonly string[],
  previousQueries: readonly string[],
  maxSearches: number,
): string[] {
  const seen = new Set(
    previousQueries.map((query) => query.trim().toLocaleLowerCase()),
  )
  const uniqueQueries: string[] = []
  for (const query of output) {
    const normalized = query.trim().toLocaleLowerCase()
    if (seen.has(normalized)) continue
    seen.add(normalized)
    uniqueQueries.push(query)
    if (uniqueQueries.length === maxSearches) break
  }
  return uniqueQueries
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
  const previousResearch = formatSearchSummaryContext(previousSearchSummaries)
  const generation = await generateArrayStream({
    userId: params.userId,
    owner: { deepSearchJobId: params.deepSearchJobId },
    prompt: [
      "<research_request>",
      params.researchRequest,
      "</research_request>",
      ...(previousSearchSummaries.length > 0
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
    element: z.string().trim().min(1).max(500),
    maxOutputTokens: 2_048,
    workflowSignal: params.workflowSignal,
    ...(params.onRegistered ? { onRegistered: params.onRegistered } : {}),
    ...(params.onFailed ? { onFailed: params.onFailed } : {}),
    ...(params.onInterrupted
      ? { onInterrupted: params.onInterrupted }
      : {}),
    ...(params.onCompleted
      ? {
          onCompleted: (
            completed: { id: string; output: string[] },
            transaction: TextStreamPersistenceTransaction,
          ) => {
            params.onCompleted?.(
              {
                id: completed.id,
                output: normalizeQueries(
                  completed.output,
                  previousQueries,
                  params.maxSearches,
                ),
              },
              transaction,
            )
          },
        }
      : {}),
  })

  const queries = awaitGenerationOutput(generation, generation.output).then(
    (output) => normalizeQueries(output, previousQueries, params.maxSearches),
  )

  return {
    streamId: generation.id,
    queries,
    completion: generation.completion,
  }
}
