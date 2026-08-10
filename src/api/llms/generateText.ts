import { generateText, Output, streamText } from "ai"
import z from "zod"
import { PromptName, loadPrompt } from "./prompts.ts"
import { llm, type LlmCallReasoning } from "./provider.ts"
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
  reasoning?: LlmCallReasoning
  model?: string
  temperature?: number
  maxOutputTokens?: number
  maxRetries?: number
}

async function loadStructuredPrompt(
  promptName: PromptName,
  schema: z.ZodType,
): Promise<string> {
  const system = await loadPrompt(promptName)
  if (llm.supportsStructuredOutputs) return system

  const jsonSchema = z.toJSONSchema(schema, { target: "draft-7" })
  return [
    system,
    "",
    "Return only valid JSON matching this JSON Schema:",
    JSON.stringify(jsonSchema),
  ].join("\n")
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
    ...llm.callOptions(params.reasoning ?? "enabled"),
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
    system: await loadStructuredPrompt(
      PromptName.GeneratePromptTitle,
      promptTitleSchema,
    ),
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
  const outputSchema = z.object({ elements: z.array(params.element) })
  const result = streamText({
    model: llm.model(params.model),
    prompt: params.prompt,
    system: await loadStructuredPrompt(params.promptName, outputSchema),
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
    reasoning?: LlmCallReasoning
    onCompleted?: (
      completed: { id: string; output: Result },
      transaction: TextStreamPersistenceTransaction,
    ) => void
  },
): Promise<{ id: string; output: Promise<Result> }> {
  const result = streamText({
    model: llm.model(params.model),
    prompt: params.prompt,
    system: await loadStructuredPrompt(params.promptName, params.schema),
    temperature: params.temperature,
    maxOutputTokens: params.maxOutputTokens,
    maxRetries: params.maxRetries,
    ...llm.callOptions(params.reasoning ?? "disabled"),
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
