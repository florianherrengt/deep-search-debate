import { createDeepSeek } from "@ai-sdk/deepseek"
import { Output, streamText } from "ai"
import type z from "zod"
import { config } from "../config.ts"
import { type PromptName, loadPrompt } from "./prompts.ts"
import {
  registerTextStream,
  type LlmGenerationOwner,
  type TextStreamPersistenceTransaction,
} from "./streams.ts"

const deepseek = createDeepSeek({
  apiKey: config.llm.deepseek.apiKey,
})

const thinkingEnabled = {
  deepseek: { thinking: { type: "enabled" as const } },
}

// Structured output must be written to the final response channel. With
// thinking enabled, DeepSeek can put valid JSON in reasoning_content and leave
// content empty, which the AI SDK correctly rejects as missing output.
const thinkingDisabled = {
  deepseek: { thinking: { type: "disabled" as const } },
}

type GenerateTextStreamInput = {
  userId: string
  owner: LlmGenerationOwner
  prompt: string
  promptName: PromptName
  model?: string
  temperature?: number
  maxOutputTokens?: number
  maxRetries?: number
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
    maxRetries: params.maxRetries,
    providerOptions: thinkingEnabled,
  })

  return {
    id: registerTextStream(params.userId, params.owner, result.stream),
  }
}

export async function generateArrayStream<Element>(
  params: GenerateTextStreamInput & { element: z.ZodType<Element> },
): Promise<{
  id: string
  output: Promise<Element[]>
  elementStream: AsyncIterable<Element>
}> {
  const result = streamText({
    model: deepseek(params.model ?? config.llm.deepseek.model),
    prompt: params.prompt,
    system: await loadPrompt(params.promptName),
    temperature: params.temperature,
    maxOutputTokens: params.maxOutputTokens,
    maxRetries: params.maxRetries,
    providerOptions: thinkingDisabled,
    output: Output.array({ element: params.element }),
  })

  return {
    id: registerTextStream(params.userId, params.owner, result.stream),
    output: Promise.resolve(result.output),
    // `output` resolves once with the full array; this iterable yields each
    // schema-validated element as soon as that element is complete.
    elementStream: result.elementStream,
  }
}

export async function generateObjectStream<Result>(
  params: GenerateTextStreamInput & {
    schema: z.ZodType<Result>
    onCompleted?: (
      completed: { id: string; output: Result },
      transaction: TextStreamPersistenceTransaction,
    ) => void
  },
): Promise<{ id: string; output: Promise<Result> }> {
  const result = streamText({
    model: deepseek(params.model ?? config.llm.deepseek.model),
    prompt: params.prompt,
    system: await loadPrompt(params.promptName),
    temperature: params.temperature,
    maxOutputTokens: params.maxOutputTokens,
    maxRetries: params.maxRetries,
    providerOptions: thinkingDisabled,
    output: Output.object({ schema: params.schema }),
  })

  const id = params.onCompleted
    ? registerTextStream(params.userId, params.owner, result.stream, {
        onCompleted: (completed, transaction) => {
          const output = params.schema.parse(
            JSON.parse(completed.text) as unknown,
          )
          params.onCompleted?.(
            { id: completed.id, output },
            transaction,
          )
        },
      })
    : registerTextStream(params.userId, params.owner, result.stream)

  return { id, output: Promise.resolve(result.output) }
}
