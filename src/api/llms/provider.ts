import {
  createModels,
  type Api,
  type Model,
  type MutableModels,
} from "@earendil-works/pi-ai"
import { deepseekProvider } from "@earendil-works/pi-ai/providers/deepseek"
import { opencodeProvider } from "@earendil-works/pi-ai/providers/opencode"

import { config, type LlmConfig } from "../config.ts"
import { OpenAiCodexError } from "../openaiConnection/codexErrors.ts"
import { reserveCodexGeneration } from "../openaiConnection/codexGeneration.ts"
import {
  deepSeekRecommendedAssignments,
  type LlmModelAssignment,
  type LlmModelAssignmentSnapshot,
} from "./modelSettings.ts"
import {
  startPiLlmStream,
  type PiLlmRequest,
} from "./piGeneration.ts"
import type { StartedLlmStream } from "./streamTypes.ts"

/** Retained on generation inputs for source compatibility; role settings win. */
export type LlmCallReasoning = "enabled" | "disabled"

type ConfiguredPiLlm = {
  models: MutableModels
  model(modelName?: string): Model<Api>
  apiKey: string
}

function requireModel(
  models: MutableModels,
  providerId: string,
  modelId: string,
): Model<Api> {
  const model = models.getModel(providerId, modelId)
  if (!model) throw new Error(`Unsupported ${providerId} model: ${modelId}`)
  return model
}

function deepSeekModel(
  models: MutableModels,
  modelId: string,
): Model<Api> {
  const model = requireModel(models, "deepseek", modelId)
  return {
    ...model,
    compat: {
      ...model.compat,
      supportsReasoningEffort: true,
    },
  }
}

function createZenModel(llmConfig: Extract<LlmConfig, { provider: "zen" }>) {
  return {
    id: llmConfig.model,
    name: llmConfig.model,
    api: "openai-completions",
    provider: "opencode",
    baseUrl: llmConfig.baseUrl,
    reasoning: true,
    thinkingLevelMap: { off: "none" },
    input: ["text"],
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
    contextWindow: 1_000_000,
    maxTokens: 384_000,
    compat: {
      supportsStore: false,
      supportsDeveloperRole: false,
      supportsReasoningEffort: true,
      maxTokensField: "max_tokens",
    },
  } as const satisfies Model<"openai-completions">
}

/** Creates the configured Pi provider while preserving arbitrary Zen model IDs. */
export function createConfiguredLlm(llmConfig: LlmConfig): ConfiguredPiLlm {
  const models = createModels()
  if (llmConfig.provider === "deepseek") {
    models.setProvider(deepseekProvider())
    return {
      models,
      model: (modelName = llmConfig.model) =>
        deepSeekModel(models, modelName),
      apiKey: llmConfig.apiKey,
    }
  }

  models.setProvider(opencodeProvider())
  const model = createZenModel(llmConfig)
  return {
    models,
    model: () => model,
    apiKey: llmConfig.apiKey,
  }
}

const llm = createConfiguredLlm(config.llm)

export type ResolvedLlmCall = {
  provider: "server" | "codex"
  modelId: string
  start(request: PiLlmRequest): StartedLlmStream
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
    modelId: model.id,
    start: (request) =>
      startPiLlmStream(
        {
          models: llm.models,
          model,
          provider: "server",
          apiKey: llm.apiKey,
          reasoningEffort: assignment.reasoningEffort,
        },
        request,
      ),
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
      if (codex) return { ...codex, provider: "codex" }
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
