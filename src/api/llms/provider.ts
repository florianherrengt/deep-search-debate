import {
  createDeepSeek,
  type DeepSeekLanguageModelChatOptions,
} from "@ai-sdk/deepseek"
import {
  createOpenAICompatible,
  type OpenAICompatibleLanguageModelChatOptions,
} from "@ai-sdk/openai-compatible"
import type { LanguageModel } from "ai"
import z from "zod"
import { config, type LlmConfig } from "../config.ts"
import { OpenAiCodexError } from "../openaiConnection/codexErrors.ts"
import { reserveCodexGeneration } from "../openaiConnection/codexGeneration.ts"
import {
  deepSeekRecommendedAssignments,
  type LlmModelAssignment,
  type LlmModelAssignmentSnapshot,
  type LlmReasoningEffort,
} from "./modelSettings.ts"

/** Retained on generation inputs for source compatibility; role settings win. */
export type LlmCallReasoning = "enabled" | "disabled"

const deepSeekReasoningEffortSchema = z.enum([
  "low",
  "medium",
  "high",
  "xhigh",
  "max",
])

if (config.environment === "production") {
  globalThis.AI_SDK_LOG_WARNINGS = false
}

/** Selects the configured server transport with the exact role effort. */
export function createConfiguredLlm(llmConfig: LlmConfig) {
  if (llmConfig.provider === "deepseek") {
    const provider = createDeepSeek({ apiKey: llmConfig.apiKey })

    return {
      model: (modelName = llmConfig.model) => provider(modelName),
      supportsStructuredOutputs: true,
      callOptions: (effort: LlmReasoningEffort) => ({
        providerOptions: {
          deepseek: effort === "none"
            ? ({ thinking: { type: "disabled" } } satisfies DeepSeekLanguageModelChatOptions)
            : ({
                thinking: { type: "enabled" },
                reasoningEffort: deepSeekReasoningEffortSchema.parse(effort),
              } satisfies DeepSeekLanguageModelChatOptions),
        },
      }),
    }
  }

  const provider = createOpenAICompatible({
    name: "zen",
    apiKey: llmConfig.apiKey,
    baseURL: llmConfig.baseUrl,
    supportsStructuredOutputs: false,
  })

  return {
    model: (modelName = llmConfig.model) => provider(modelName),
    supportsStructuredOutputs: false,
    callOptions: (effort: LlmReasoningEffort) => ({
      providerOptions: {
        zen: {
          reasoningEffort: effort,
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
    legacyReasoning?: LlmCallReasoning,
    legacyModelOverride?: string,
  ): Promise<ResolvedLlmCall>
  release(): void
}

function resolveServerLlmCall(
  assignment: LlmModelAssignment = deepSeekRecommendedAssignments.big,
): ResolvedLlmCall {
  const model = config.llm.provider === "zen"
    ? llm.model()
    : llm.model(assignment.modelId)
  return {
    provider: "server",
    model,
    modelId: model.modelId,
    supportsStructuredOutputs: llm.supportsStructuredOutputs,
    callOptions: llm.callOptions(assignment.reasoningEffort),
    wrapStream: (source) => source,
    release: () => Promise.resolve(),
  }
}

/** Reserves the provider named by the snapshotted role assignment. */
export async function reserveLlmCall(
  userId: string,
  snapshot: LlmModelAssignmentSnapshot,
  signal?: AbortSignal,
): Promise<LlmCallReservation> {
  if (snapshot.assignment.provider === "deepseek") {
    let consumed = false
    return {
      resolve() {
        if (consumed) throw new Error("LLM call reservation was already consumed")
        consumed = true
        return Promise.resolve(resolveServerLlmCall(snapshot.assignment))
      },
      release() {
        consumed = true
      },
    }
  }

  const codexReservation = await reserveCodexGeneration(
    userId,
    {
      modelId: snapshot.assignment.modelId,
      reasoningEffort: snapshot.assignment.reasoningEffort,
      allowUnavailableRecommendationFallback: !snapshot.explicit,
    },
    signal,
  )
  if (!codexReservation && snapshot.explicit) {
    throw new OpenAiCodexError("authentication-required")
  }

  let consumed = false
  return {
    async resolve() {
      if (consumed) throw new Error("LLM call reservation was already consumed")
      consumed = true
      const codex = await codexReservation?.acquire()
      if (codex) {
        return {
          ...codex,
          provider: "codex",
          supportsStructuredOutputs: true,
          callOptions: {},
        }
      }
      if (snapshot.explicit) {
        throw new OpenAiCodexError("authentication-required")
      }
      return resolveServerLlmCall(
        deepSeekRecommendedAssignments[snapshot.role],
      )
    },
    release() {
      if (consumed) return
      consumed = true
      codexReservation?.release()
    },
  }
}
