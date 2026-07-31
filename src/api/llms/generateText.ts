import { createDeepSeek } from "@ai-sdk/deepseek"
import { streamText } from "ai"
import z from "zod"
import { config } from "../config.ts"
import { PromptName, loadPrompt } from "./prompts.ts"
import { registerTextStream } from "./streams.ts"

const deepseek = createDeepSeek({
  apiKey: config.llm.deepseek.apiKey,
})

export const generateTextStream = z
  .function()
  .input(
    z.tuple([
      z.object({
        prompt: z.string(),
        promptName: z.enum(PromptName),
        model: z.string().optional(),
        temperature: z.number().optional(),
        maxOutputTokens: z.number().optional(),
      }),
    ]),
  )
  .output(z.object({ id: z.string() }))
  .implementAsync(async (params) => {
    const result = streamText({
      model: deepseek(params.model ?? config.llm.deepseek.model),
      prompt: params.prompt,
      system: await loadPrompt(params.promptName),
      temperature: params.temperature,
      maxOutputTokens: params.maxOutputTokens,
      providerOptions: { deepseek: { thinking: { type: "enabled" as const } } },
    })

    return { id: registerTextStream(result.stream) }
  })
