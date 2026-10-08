import z from "zod"

import { createBoundedFetch } from "../web_search/boundedFetch.ts"
import { getDeepSeekApiKey, hasDeepSeekApiKey } from "../deepseekConnection/keysRepository.ts"
import { OpenAiCodexError } from "../openaiConnection/codexErrors.ts"
import { listAvailableCodexModels } from "../openaiConnection/codexGeneration.ts"
import { hasOpenAiCodexConnection } from "../openaiConnection/credentialsRepository.ts"
import {
  getStoredLlmModelAssignments,
  llmModelAssignmentSchema,
  replaceLlmModelAssignments,
  type LlmModelAssignment,
  type LlmModelAssignments,
  type LlmModelProvider,
  type LlmReasoningEffort,
} from "./modelSettings.ts"

const DEEPSEEK_MODELS_URL = "https://api.deepseek.com/models"
const MAX_MODEL_LIST_BYTES = 256 * 1_024
const MODEL_DISCOVERY_TIMEOUT_MS = 15_000

const reasoningEffortSchema = z.enum([
  "none",
  "minimal",
  "low",
  "medium",
  "high",
  "xhigh",
  "max",
])
const deepSeekModelListSchema = z.object({
  data: z.array(z.looseObject({
    id: z.string().min(1).max(256),
    name: z.string().optional(),
    display_name: z.string().optional(),
    description: z.string().optional(),
    reasoning_efforts: z.array(z.string()).optional(),
    supported_reasoning_efforts: z.array(z.union([
      z.string(),
      z.looseObject({ reasoningEffort: z.string() }),
      z.looseObject({ reasoning_effort: z.string() }),
    ])).optional(),
  })),
}).loose()

const defaultDeepSeekReasoningEfforts = [
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
  assignments: LlmModelAssignments | null
}

type Catalog = Pick<LlmModelSettingsSnapshot, "models" | "availability">

function modelReasoningEfforts(model: z.output<typeof deepSeekModelListSchema>["data"][number]): LlmReasoningEffort[] {
  const advertised = model.reasoning_efforts ?? model.supported_reasoning_efforts?.map(
    (effort) => typeof effort === "string"
      ? effort
      : "reasoningEffort" in effort
        ? effort.reasoningEffort
        : effort.reasoning_effort,
  )
  if (!advertised) return [...defaultDeepSeekReasoningEfforts]
  const efforts = [...new Set(advertised.flatMap((effort) => {
    const parsed = reasoningEffortSchema.safeParse(effort)
    return parsed.success ? [parsed.data] : []
  }))]
  return efforts.length > 0 ? efforts : [...defaultDeepSeekReasoningEfforts]
}

async function listDeepSeekModels(userId: string): Promise<LlmModelOption[]> {
  const apiKey = getDeepSeekApiKey(userId)
  if (!apiKey) throw new Error("DeepSeek is disconnected")
  const boundedFetch = createBoundedFetch(MAX_MODEL_LIST_BYTES)
  const response = await boundedFetch(DEEPSEEK_MODELS_URL, {
    headers: { authorization: `Bearer ${apiKey}` },
    signal: AbortSignal.timeout(MODEL_DISCOVERY_TIMEOUT_MS),
  })
  if (!response.ok) throw new Error("DeepSeek model discovery failed")
  const result = deepSeekModelListSchema.parse(await response.json())
  return result.data.map((model) => ({
    provider: "deepseek" as const,
    providerLabel: "DeepSeek" as const,
    modelId: model.id,
    label: model.display_name ?? model.name ?? model.id,
    ...(model.description ? { description: model.description } : {}),
    reasoningEfforts: modelReasoningEfforts(model),
  }))
}

async function discoverDeepSeek(userId: string): Promise<{
  models: LlmModelOption[]
  availability: LlmProviderAvailability
}> {
  if (!hasDeepSeekApiKey(userId)) {
    return { models: [], availability: { status: "disconnected" } }
  }
  try {
    const models = await listDeepSeekModels(userId)
    return {
      models,
      availability: models.length > 0
        ? { status: "available" }
        : {
            status: "unavailable",
            message: "No DeepSeek models are currently available.",
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
    const deadline = AbortSignal.timeout(MODEL_DISCOVERY_TIMEOUT_MS)
    const timedOut = Promise.withResolvers<never>()
    const onAbort = () => timedOut.reject(deadline.reason)
    deadline.addEventListener("abort", onAbort, { once: true })
    let listed: Awaited<ReturnType<typeof listAvailableCodexModels>>
    try {
      listed = await Promise.race([
        listAvailableCodexModels(userId, deadline),
        timedOut.promise,
      ])
    } finally {
      deadline.removeEventListener("abort", onAbort)
    }
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
  const [openai, deepseek] = await Promise.all([
    discoverOpenAi(userId),
    discoverDeepSeek(userId),
  ])
  return {
    models: [...openai.models, ...deepseek.models],
    availability: {
      openai: openai.availability,
      deepseek: deepseek.availability,
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

function snapshotFromCatalog(
  userId: string,
  catalog: Catalog,
): LlmModelSettingsSnapshot {
  return {
    ...catalog,
    assignments: getStoredLlmModelAssignments(userId) ?? null,
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
