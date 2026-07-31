import { createDeepSeek } from "@ai-sdk/deepseek"
import { streamText } from "ai"
import z from "zod"
import { config } from "../config.ts"

const deepseek = createDeepSeek({
  apiKey: config.llm.deepseek.apiKey,
})

const GenerateTextInput = z.object({
  prompt: z.string(),
  system: z.string().optional(),
  model: z.string().optional().default(config.llm.deepseek.model),
  temperature: z.number().optional(),
  maxOutputTokens: z.number().optional(),
})

export function generateTextStream(input: z.input<typeof GenerateTextInput>) {
  const params = GenerateTextInput.parse(input)
  return streamText({
    model: deepseek(params.model),
    prompt: params.prompt,
    system: params.system,
    temperature: params.temperature,
    maxOutputTokens: params.maxOutputTokens,
  })
}
