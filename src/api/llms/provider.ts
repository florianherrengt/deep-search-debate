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
      supportsStructuredOutputs: true,
      callOptions: (reasoning: LlmCallReasoning) => ({
        providerOptions: {
          deepseek: {
            thinking: { type: reasoning },
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
