import { generateTextStream } from "../../llms/generateText.ts"
import { PromptName } from "../../llms/prompts.ts"

type QuerySummaryResult = {
  title: string
  url: string
  content: string
}

type SummarizeSearchQueryInput = {
  researchRequest: string
  query: string
  results: QuerySummaryResult[]
}

/** Registers a top-level synthesis stream for all content returned by one web search. */
export async function summarizeSearchQuery(
  params: SummarizeSearchQueryInput,
): Promise<string> {
    const formattedResults = params.results
      .map(
        (result) =>
          [
            "<result>",
            `Title: ${result.title}`,
            `URL: ${result.url}`,
            "Content:",
            result.content,
            "</result>",
          ].join("\n"),
      )
      .join("\n\n")

    const prompt = [
      `user_query: ${params.researchRequest}`,
      `search_query: ${params.query}`,
      "results:",
      "<results>",
      formattedResults,
      "</results>",
    ].join("\n")

    const { id } = await generateTextStream({
      prompt,
      promptName: PromptName.SummarizeSearchQuery,
    })
    return id
}
