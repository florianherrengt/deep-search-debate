import {
  createDeepSeek,
  type DeepSeekLanguageModelChatOptions,
} from "@ai-sdk/deepseek"
import {
  createOpenAICompatible,
  type OpenAICompatibleLanguageModelChatOptions,
} from "@ai-sdk/openai-compatible"
import type { LanguageModel } from "ai"
import { config, type LlmConfig } from "../config.ts"
import { reserveCodexGeneration } from "../openaiConnection/codexGeneration.ts"

export type LlmCallReasoning = "enabled" | "disabled"

if (config.environment === "production") {
  // Warning objects remain available on AI SDK results; only their automatic
  // process-level logging is disabled in production.
  globalThis.AI_SDK_LOG_WARNINGS = false
}

/**
 * Selects the transport while keeping reasoning policy at each generation call.
 */
export function createConfiguredLlm(llmConfig: LlmConfig) {
  if (llmConfig.provider === "deepseek") {
    const provider = createDeepSeek({
      apiKey: llmConfig.apiKey,
    })

    return {
      model: (modelName = llmConfig.model) => provider(modelName),
      // This application flag means the provider owns schema instructions; it
      // does not claim that DeepSeek supports native `json_schema`. The adapter
      // injects the schema once in `json_object` compatibility mode, so false
      // here would make loadStructuredPrompt inject a duplicate.
      supportsStructuredOutputs: true,
      callOptions: (reasoning: LlmCallReasoning) => ({
        providerOptions: {
          deepseek: {
            thinking: { type: reasoning },
            // Reasoning-enabled calls request the maximum thinking strength;
            // disabled calls stay effort-free.
            ...(reasoning === "enabled" && { reasoningEffort: "max" }),
          } satisfies DeepSeekLanguageModelChatOptions,
        },
      }),
    }
  }

  const provider = createOpenAICompatible({
    name: "zen",
    apiKey: llmConfig.apiKey,
    baseURL: llmConfig.baseUrl,
    // Zen's free DeepSeek transport currently accepts JSON object mode but
    // rejects OpenAI's stricter `json_schema` response format.
    supportsStructuredOutputs: false,
  })

  return {
    model: (modelName = llmConfig.model) => provider(modelName),
    supportsStructuredOutputs: false,
    callOptions: (reasoning: LlmCallReasoning) => ({
      providerOptions: {
        zen: {
          reasoningEffort: reasoning === "enabled" ? "high" : "none",
        } satisfies OpenAICompatibleLanguageModelChatOptions,
      },
    }),
  }
}

const llm = createConfiguredLlm(config.llm)

export type ResolvedLlmCall = {
  provider: "server" | "codex"
  model: LanguageModel
  modelId: string
  supportsStructuredOutputs: boolean
  callOptions: Record<string, unknown>
  wrapStream<Part>(source: AsyncIterable<Part>): AsyncIterable<Part>
  release(): Promise<void>
}

export type LlmCallReservation = {
  resolve(
    reasoning: LlmCallReasoning,
    modelOverride?: string,
  ): Promise<ResolvedLlmCall>
  release(): void
}

function resolveServerLlmCall(
  reasoning: LlmCallReasoning,
  modelOverride?: string,
): ResolvedLlmCall {
  const model = llm.model(modelOverride)
  return {
    provider: "server",
    model,
    modelId: model.modelId,
    supportsStructuredOutputs: llm.supportsStructuredOutputs,
    callOptions: llm.callOptions(reasoning),
    wrapStream: (source) => source,
    release: () => Promise.resolve(),
  }
}

/** Reserves per-user Codex serialization without occupying shared LLM capacity. */
export async function reserveLlmCall(
  userId: string,
  signal?: AbortSignal,
): Promise<LlmCallReservation> {
  const codexReservation = await reserveCodexGeneration(userId, signal)
  let consumed = false
  return {
    async resolve(reasoning, modelOverride) {
      if (consumed) throw new Error("LLM call reservation was already consumed")
      consumed = true
      const codex = await codexReservation?.acquire(reasoning)
      if (codex) {
        return {
          ...codex,
          provider: "codex",
          supportsStructuredOutputs: true,
          callOptions: {},
        }
      }
      return resolveServerLlmCall(reasoning, modelOverride)
    },
    release() {
      if (consumed) return
      consumed = true
      codexReservation?.release()
    },
  }
}
