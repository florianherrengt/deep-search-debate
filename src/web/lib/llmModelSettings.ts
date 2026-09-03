import z from "zod"

import { getJson, putJson } from "./api.ts"

export const llmModelSettingsQueryKey = ["llm-model-settings"] as const

const reasoningEffortSchema = z.enum([
  "none",
  "minimal",
  "low",
  "medium",
  "high",
  "xhigh",
  "max",
  "ultra",
])

const providerSchema = z.enum(["deepseek", "openai"])

const modelAssignmentSchema = z.object({
  provider: providerSchema,
  modelId: z.string().min(1),
  reasoningEffort: reasoningEffortSchema,
})

const modelOptionSchema = z.object({
  provider: providerSchema,
  providerLabel: z.enum(["DeepSeek", "OpenAI"]),
  modelId: z.string().min(1),
  label: z.string().min(1),
  description: z.string().min(1).optional(),
  reasoningEfforts: z.array(reasoningEffortSchema).min(1),
})

const providerAvailabilitySchema = z.object({
  status: z.enum(["available", "unavailable", "disconnected"]),
  message: z.string().min(1).optional(),
})

export const llmModelSettingsSchema = z.object({
  models: z.array(modelOptionSchema),
  availability: z.object({
    deepseek: providerAvailabilitySchema,
    openai: providerAvailabilitySchema,
  }),
  assignments: z.object({
    small: modelAssignmentSchema,
    big: modelAssignmentSchema,
  }),
  recommendations: z.object({
    small: modelAssignmentSchema,
    big: modelAssignmentSchema,
  }),
})

export type LlmModelSettings = z.infer<typeof llmModelSettingsSchema>
export type ModelAssignment = z.infer<typeof modelAssignmentSchema>
export type ReasoningEffort = z.infer<typeof reasoningEffortSchema>

export function getLlmModelSettings(signal?: AbortSignal) {
  return getJson(
    "/api/llm-model-settings",
    llmModelSettingsSchema,
    signal,
  )
}

export function updateLlmModelSettings(assignments: {
  small: ModelAssignment
  big: ModelAssignment
}) {
  return putJson(
    "/api/llm-model-settings",
    { assignments },
    llmModelSettingsSchema,
  )
}
