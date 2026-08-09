import { generateText, Output, streamText } from "ai"
import z from "zod"
import { PromptName, loadPrompt } from "./prompts.ts"
import { llm } from "./provider.ts"
import {
  registerTextStream,
  type LlmGenerationOwner,
  type TextStreamPersistenceTransaction,
} from "./streams.ts"

const promptTitleSchema = z.object({
  title: z.string().trim().min(1).max(80),
})

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
    model: llm.model(params.model),
    prompt: params.prompt,
    system: await loadPrompt(params.promptName),
    temperature: params.temperature,
    maxOutputTokens: params.maxOutputTokens,
    maxRetries: params.maxRetries,
    ...llm.callOptions("enabled"),
  })

  return {
    id: registerTextStream(params.userId, params.owner, result.stream),
  }
}

/** Generates the immutable display title used before a durable job starts. */
export async function generatePromptTitle(prompt: string): Promise<string> {
  const result = await generateText({
    model: llm.model(),
    prompt: `<user_request>\n${prompt}\n</user_request>`,
    system: await loadPrompt(PromptName.GeneratePromptTitle),
    maxOutputTokens: 50,
    ...llm.callOptions("disabled"),
    output: Output.object({ schema: promptTitleSchema }),
  })

  return result.output.title
}

export async function generateArrayStream<Element>(
  params: GenerateTextStreamInput & { element: z.ZodType<Element> },
): Promise<{
  id: string
  output: Promise<Element[]>
  elementStream: AsyncIterable<Element>
}> {
  const result = streamText({
    model: llm.model(params.model),
    prompt: params.prompt,
    system: await loadPrompt(params.promptName),
    temperature: params.temperature,
    maxOutputTokens: params.maxOutputTokens,
    maxRetries: params.maxRetries,
    ...llm.callOptions("disabled"),
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
    model: llm.model(params.model),
    prompt: params.prompt,
    system: await loadPrompt(params.promptName),
    temperature: params.temperature,
    maxOutputTokens: params.maxOutputTokens,
    maxRetries: params.maxRetries,
    ...llm.callOptions("disabled"),
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
