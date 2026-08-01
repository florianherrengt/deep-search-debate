import z from "zod"
import { generateTextStream } from "../../llms/generateText.ts"
import { PromptName } from "../../llms/prompts.ts"

const querySummaryResultSchema = z.object({
  title: z.string(),
  url: z.string(),
  content: z.string(),
})

/** Registers a synthesis stream for all content returned by one web search. */
export const summarizeSearchQuery = z
  .function()
  .input(
    z.tuple([
      z.object({
        researchRequest: z.string().min(1),
        query: z.string().min(1),
        results: z.array(querySummaryResultSchema),
      }),
    ]),
  )
  .output(z.string())
  .implementAsync(async (params) => {
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
  })
