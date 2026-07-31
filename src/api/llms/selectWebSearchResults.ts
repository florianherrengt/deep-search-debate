import { createDeepSeek } from "@ai-sdk/deepseek"
import { generateText, Output } from "ai"
import z from "zod"
import { config } from "../config.ts"
import { PromptName, loadPrompt } from "./prompts.ts"

const deepseek = createDeepSeek({
  apiKey: config.llm.deepseek.apiKey,
})

const searchResultSchema = z.object({
  id: z.string(),
  title: z.string(),
  url: z.string(),
  snippet: z.string(),
})

export const selectWebSearchResults = z
  .function()
  .input(
    z.tuple([
      z.object({
        userQuery: z.string(),
        searchQuery: z.string(),
        results: z.array(searchResultSchema),
      }),
    ]),
  )
  .output(z.array(z.string()))
  .implementAsync(async (params) => {
    const formattedResults = params.results
      .map(
        (r) =>
          `ID: ${r.id}\nTitle: ${r.title}\nURL: ${r.url}\nSnippet: ${r.snippet}`,
      )
      .join("\n\n")

    const prompt = [
      `user_query: ${params.userQuery}`,
      `search_query: ${params.searchQuery}`,
      `results:`,
      formattedResults,
    ].join("\n")

    const { output } = await generateText({
      model: deepseek(config.llm.deepseek.model),
      prompt,
      system: await loadPrompt(PromptName.SelectWebSearchResults),
      output: Output.array({ element: z.string() }),
    })
    return output
  })
