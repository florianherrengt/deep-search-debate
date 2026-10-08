import {
  createModels,
  type Api,
  type Model,
  type MutableModels,
} from "@earendil-works/pi-ai"
import { deepseekProvider } from "@earendil-works/pi-ai/providers/deepseek"
import { opencodeProvider } from "@earendil-works/pi-ai/providers/opencode"

import type { LlmConfig } from "../config.ts"
import { getDeepSeekApiKey } from "../deepseekConnection/keysRepository.ts"
import { OpenAiCodexError } from "../openaiConnection/codexErrors.ts"
import { reserveCodexGeneration } from "../openaiConnection/codexGeneration.ts"
import {
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

function deepSeekModel(
  models: MutableModels,
  modelId: string,
  reasoningEffort: LlmModelAssignment["reasoningEffort"],
): Model<Api> {
  const template = models.getModel("deepseek", modelId) ??
    models.getModel("deepseek", "deepseek-v4-flash")
  if (!template) throw new Error("DeepSeek provider model metadata is unavailable")
  const model: Model<Api> = {
    ...template,
    id: modelId,
    name: modelId,
    thinkingLevelMap: {
      ...template.thinkingLevelMap,
      ...(reasoningEffort !== "none" && {
        [reasoningEffort]: reasoningEffort,
      }),
    },
  }
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

/** Creates the development Zen provider while preserving arbitrary model IDs. */
export function createConfiguredLlm(llmConfig: LlmConfig): ConfiguredPiLlm {
  const models = createModels()
  models.setProvider(opencodeProvider())
  const model = createZenModel(llmConfig)
  return {
    models,
    model: () => model,
    apiKey: llmConfig.apiKey,
  }
}

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

class DeepSeekKeyRequiredError extends Error {
  readonly code = "deepseek-key-required"

  constructor() {
    super("Add a DeepSeek API key before using a DeepSeek model.")
    this.name = "DeepSeekKeyRequiredError"
  }
}

function resolveDeepSeekLlmCall(
  assignment: LlmModelAssignment,
  apiKey: string,
): ResolvedLlmCall {
  const models = createModels()
  models.setProvider(deepseekProvider())
  const model = deepSeekModel(
    models,
    assignment.modelId,
    assignment.reasoningEffort,
  )
  return {
    provider: "server",
    modelId: model.id,
    start: (request) =>
      startPiLlmStream(
        {
          models,
          model,
          provider: "server",
          apiKey,
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
        const apiKey = getDeepSeekApiKey(userId)
        if (!apiKey) throw new DeepSeekKeyRequiredError()
        return Promise.resolve(resolveDeepSeekLlmCall(snapshot.assignment, apiKey))
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
      allowUnavailableRecommendationFallback: false,
    },
    signal,
  )
  if (!codexReservation) {
    throw new OpenAiCodexError("authentication-required")
  }

  let consumed = false
  return {
    async resolve() {
      if (consumed) throw new Error("LLM call reservation was already consumed")
      consumed = true
      const codex = await codexReservation.acquire()
      if (codex) return { ...codex, provider: "codex" }
      throw new OpenAiCodexError("authentication-required")
    },
    release() {
      if (consumed) return
      consumed = true
      codexReservation?.release()
    },
  }
}
