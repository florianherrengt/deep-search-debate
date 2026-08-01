import { createDeepSeek } from "@ai-sdk/deepseek"
import { Output, streamText } from "ai"
import type z from "zod"
import { config } from "../config.ts"
import { type PromptName, loadPrompt } from "./prompts.ts"
import { registerTextStream } from "./streams.ts"

const deepseek = createDeepSeek({
  apiKey: config.llm.deepseek.apiKey,
})

type GenerateTextStreamInput = {
  prompt: string
  promptName: PromptName
  model?: string
  temperature?: number
  maxOutputTokens?: number
}

export async function generateTextStream(
  params: GenerateTextStreamInput,
): Promise<{ id: string }> {
  const result = streamText({
    model: deepseek(params.model ?? config.llm.deepseek.model),
    prompt: params.prompt,
    system: await loadPrompt(params.promptName),
    temperature: params.temperature,
    maxOutputTokens: params.maxOutputTokens,
    providerOptions: { deepseek: { thinking: { type: "enabled" as const } } },
  })

  return { id: registerTextStream(result.stream) }
}

export async function generateArrayStream<Element>(
  params: GenerateTextStreamInput & { element: z.ZodType<Element> },
): Promise<{ id: string; output: Promise<Element[]> }> {
  const result = streamText({
    model: deepseek(params.model ?? config.llm.deepseek.model),
    prompt: params.prompt,
    system: await loadPrompt(params.promptName),
    temperature: params.temperature,
    maxOutputTokens: params.maxOutputTokens,
    providerOptions: { deepseek: { thinking: { type: "enabled" as const } } },
    output: Output.array({ element: params.element }),
  })

  return {
    id: registerTextStream(result.stream),
    output: Promise.resolve(result.output),
  }
}
