import z from "zod"

import { config } from "../config.ts"
import { createBoundedFetch } from "../web_search/boundedFetch.ts"
import { OpenAiCodexError } from "../openaiConnection/codexErrors.ts"
import { listAvailableCodexModels } from "../openaiConnection/codexGeneration.ts"
import { hasOpenAiCodexConnection } from "../openaiConnection/credentialsRepository.ts"
import {
  deepSeekRecommendedAssignments,
  getStoredLlmModelAssignments,
  llmModelAssignmentSchema,
  openAiRecommendedAssignments,
  replaceLlmModelAssignments,
  type LlmModelAssignment,
  type LlmModelAssignments,
  type LlmModelProvider,
  type LlmReasoningEffort,
} from "./modelSettings.ts"

const DEEPSEEK_MODELS_URL = "https://api.deepseek.com/models"
const MAX_MODEL_LIST_BYTES = 256 * 1_024

const deepSeekModelListSchema = z.object({
  data: z.array(
    z.looseObject({
      id: z.string().min(1).max(256),
    }),
  ).max(500),
}).loose()

const deepSeekModelDetails = {
  "deepseek-v4-flash": "DeepSeek V4 Flash",
  "deepseek-v4-pro": "DeepSeek V4 Pro",
} as const

const deepSeekReasoningEfforts = [
  "none",
  "low",
  "medium",
  "high",
  "xhigh",
  "max",
] as const satisfies readonly LlmReasoningEffort[]

type LlmModelOption = {
  provider: LlmModelProvider
  providerLabel: "DeepSeek" | "OpenAI"
  modelId: string
  label: string
  description?: string
  reasoningEfforts: LlmReasoningEffort[]
}

type LlmProviderAvailability = {
  status: "available" | "unavailable" | "disconnected"
  message?: string
}

export type LlmModelSettingsSnapshot = {
  models: LlmModelOption[]
  availability: Record<LlmModelProvider, LlmProviderAvailability>
  assignments: LlmModelAssignments
  recommendations: LlmModelAssignments
}

type Catalog = Pick<LlmModelSettingsSnapshot, "models" | "availability">

async function listDeepSeekModels(): Promise<LlmModelOption[]> {
  if (config.llm.provider !== "deepseek") {
    throw new Error("DeepSeek is not configured")
  }
  const boundedFetch = createBoundedFetch(MAX_MODEL_LIST_BYTES)
  const response = await boundedFetch(DEEPSEEK_MODELS_URL, {
    headers: { authorization: `Bearer ${config.llm.apiKey}` },
    signal: AbortSignal.timeout(config.llmExecution.firstChunkTimeoutMs),
  })
  if (!response.ok) throw new Error("DeepSeek model discovery failed")
  const result = deepSeekModelListSchema.parse(await response.json())
  const advertised = new Set(result.data.map((model) => model.id))
  return Object.entries(deepSeekModelDetails)
    .filter(([modelId]) => advertised.has(modelId))
    .map(([modelId, label]) => ({
      provider: "deepseek" as const,
      providerLabel: "DeepSeek" as const,
      modelId,
      label,
      reasoningEfforts: [...deepSeekReasoningEfforts],
    }))
}

async function discoverDeepSeek(): Promise<{
  models: LlmModelOption[]
  availability: LlmProviderAvailability
}> {
  try {
    const models = await listDeepSeekModels()
    return {
      models,
      availability: models.length > 0
        ? { status: "available" }
        : {
            status: "unavailable",
            message: "No supported DeepSeek models are currently available.",
          },
    }
  } catch {
    return {
      models: [],
      availability: {
        status: "unavailable",
        message: "Could not load DeepSeek models.",
      },
    }
  }
}

async function discoverOpenAi(userId: string): Promise<{
  models: LlmModelOption[]
  availability: LlmProviderAvailability
}> {
  if (!hasOpenAiCodexConnection(userId)) {
    return { models: [], availability: { status: "disconnected" } }
  }
  try {
    const listed = await listAvailableCodexModels(userId)
    if (!listed) return { models: [], availability: { status: "disconnected" } }
    const models = listed.map((model): LlmModelOption => ({
      provider: "openai",
      providerLabel: "OpenAI",
      modelId: model.id,
      label: model.displayName ?? model.name ?? model.id,
      ...(model.description ? { description: model.description } : {}),
      reasoningEfforts: [
        ...new Set(
          model.supportedReasoningEfforts.map(
            (option) => option.reasoningEffort,
          ),
        ),
      ],
    }))
    return {
      models,
      availability: models.length > 0
        ? { status: "available" }
        : {
            status: "unavailable",
            message: "No OpenAI models are currently available.",
          },
    }
  } catch (error) {
    return {
      models: [],
      availability: {
        status: "unavailable",
        message: error instanceof OpenAiCodexError
          ? error.message
          : "Could not load OpenAI models.",
      },
    }
  }
}

async function loadCatalog(userId: string): Promise<Catalog> {
  const [deepseek, openai] = await Promise.all([
    discoverDeepSeek(),
    discoverOpenAi(userId),
  ])
  return {
    models: [...deepseek.models, ...openai.models],
    availability: {
      deepseek: deepseek.availability,
      openai: openai.availability,
    },
  }
}

function supportsAssignment(
  models: LlmModelOption[],
  assignment: LlmModelAssignment,
): boolean {
  return models.some(
    (model) =>
      model.provider === assignment.provider &&
      model.modelId === assignment.modelId &&
      model.reasoningEfforts.includes(assignment.reasoningEffort),
  )
}

function recommendationsFor(models: LlmModelOption[]): LlmModelAssignments {
  return {
    small: supportsAssignment(models, openAiRecommendedAssignments.small)
      ? openAiRecommendedAssignments.small
      : deepSeekRecommendedAssignments.small,
    big: supportsAssignment(models, openAiRecommendedAssignments.big)
      ? openAiRecommendedAssignments.big
      : deepSeekRecommendedAssignments.big,
  }
}

function snapshotFromCatalog(
  userId: string,
  catalog: Catalog,
): LlmModelSettingsSnapshot {
  const recommendations = recommendationsFor(catalog.models)
  return {
    ...catalog,
    assignments: getStoredLlmModelAssignments(userId) ?? recommendations,
    recommendations,
  }
}

export async function getLlmModelSettingsSnapshot(
  userId: string,
): Promise<LlmModelSettingsSnapshot> {
  return snapshotFromCatalog(userId, await loadCatalog(userId))
}

export class InvalidLlmModelAssignmentError extends Error {
  constructor() {
    super("Selected model or reasoning effort is unavailable.")
    this.name = "InvalidLlmModelAssignmentError"
  }
}

export async function putLlmModelSettings(
  userId: string,
  assignments: LlmModelAssignments,
): Promise<LlmModelSettingsSnapshot> {
  const parsed = {
    small: llmModelAssignmentSchema.parse(assignments.small),
    big: llmModelAssignmentSchema.parse(assignments.big),
  }
  const catalog = await loadCatalog(userId)
  if (
    !supportsAssignment(catalog.models, parsed.small) ||
    !supportsAssignment(catalog.models, parsed.big)
  ) {
    throw new InvalidLlmModelAssignmentError()
  }
  if (!replaceLlmModelAssignments(userId, parsed)) {
    throw new InvalidLlmModelAssignmentError()
  }
  return snapshotFromCatalog(userId, catalog)
}
