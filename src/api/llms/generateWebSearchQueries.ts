import { createDeepSeek } from "@ai-sdk/deepseek"
import { generateText, Output } from "ai"
import z from "zod"
import { config } from "../config.ts"
import { PromptName, loadPrompt } from "./prompts.ts"

const deepseek = createDeepSeek({
  apiKey: config.llm.deepseek.apiKey,
})

export const generateWebSearchQueries = z
  .function()
  .input(z.tuple([z.object({ researchRequest: z.string() })]))
  .output(z.array(z.string()))
  .implementAsync(async (params) => {
    const { output } = await generateText({
      model: deepseek(config.llm.deepseek.model),
      prompt: params.researchRequest,
      system: await loadPrompt(PromptName.GenerateWebSearchQueries),
      output: Output.array({ element: z.string() }),
    })
    return output
  })
