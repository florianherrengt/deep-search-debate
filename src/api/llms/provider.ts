import {
  createDeepSeek,
  type DeepSeekLanguageModelChatOptions,
} from "@ai-sdk/deepseek"
import {
  createOpenAICompatible,
  type OpenAICompatibleLanguageModelChatOptions,
} from "@ai-sdk/openai-compatible"
import { config, type LlmConfig } from "../config.ts"

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

export const llm = createConfiguredLlm(config.llm)
