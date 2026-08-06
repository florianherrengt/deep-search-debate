import { generateTextStream } from "../../llms/generateText.ts"
import { PromptName } from "../../llms/prompts.ts"

type SearchSummary = {
  query: string
  content: string
}

type AnswerResearchRequestInput = {
  userId: string
  deepSearchJobId: string
  researchRequest: string
  searchSummaries: SearchSummary[]
  maxRetries?: number
}

/** Registers the final synthesis stream for a completed set of search summaries. */
export async function answerResearchRequest(
  params: AnswerResearchRequestInput,
): Promise<string> {
  const formattedSummaries = params.searchSummaries
    .map(
      (summary) =>
        [
          "<search_summary>",
          `Search query: ${summary.query}`,
          "Summary:",
          summary.content,
          "</search_summary>",
        ].join("\n"),
    )
    .join("\n\n")

  const prompt = [
    `user_query: ${params.researchRequest}`,
    "search_summaries:",
    "<search_summaries>",
    formattedSummaries,
    "</search_summaries>",
  ].join("\n")

  const { id } = await generateTextStream({
    userId: params.userId,
    owner: { deepSearchJobId: params.deepSearchJobId },
    prompt,
    promptName: PromptName.AnswerResearchRequest,
    maxRetries: params.maxRetries,
  })
  return id
}
