import { eq } from "drizzle-orm"
import z from "zod"

import { db } from "../db/index.ts"
import {
  llmModelProviders,
  llmModelSettings,
  llmReasoningEfforts,
  openAiCodexConnections,
} from "../db/schema/index.ts"
import { hasOpenAiCodexConnection } from "../openaiConnection/credentialsRepository.ts"
import type { PromptName } from "./prompts.ts"

const llmModelProviderSchema = z.enum(llmModelProviders)
export type LlmModelProvider = z.output<typeof llmModelProviderSchema>

export const llmReasoningEffortSchema = z.enum(llmReasoningEfforts)
export type LlmReasoningEffort = z.output<typeof llmReasoningEffortSchema>

export const llmModelAssignmentSchema = z.object({
  provider: llmModelProviderSchema,
  modelId: z.string().trim().min(1),
  reasoningEffort: llmReasoningEffortSchema,
})
export type LlmModelAssignment = z.output<typeof llmModelAssignmentSchema>

const llmModelAssignmentsSchema = z.object({
  small: llmModelAssignmentSchema,
  big: llmModelAssignmentSchema,
})
export type LlmModelAssignments = z.output<typeof llmModelAssignmentsSchema>

export const replaceLlmModelSettingsInputSchema = z.object({
  assignments: llmModelAssignmentsSchema,
}).strict()

export type LlmModelRole = keyof LlmModelAssignments

export const deepSeekRecommendedAssignments = {
  small: {
    provider: "deepseek",
    modelId: "deepseek-v4-flash",
    reasoningEffort: "medium",
  },
  big: {
    provider: "deepseek",
    modelId: "deepseek-v4-pro",
    reasoningEffort: "xhigh",
  },
} as const satisfies LlmModelAssignments

export const openAiRecommendedAssignments = {
  small: {
    provider: "openai",
    modelId: "gpt-5.6-luna",
    reasoningEffort: "medium",
  },
  big: {
    provider: "openai",
    modelId: "gpt-5.6-sol",
    reasoningEffort: "xhigh",
  },
} as const satisfies LlmModelAssignments

export function modelRoleForPrompt(promptName: PromptName): LlmModelRole {
  switch (promptName) {
    case "generate-prompt-title":
    case "select-websearch-results":
    case "summarize-web-page":
    case "summarize-search-query":
    case "summarize-idea-research":
      return "small"
    case "default":
    case "generate-websearch-queries":
    case "answer-research-request":
    case "analyze-research-answer":
    case "review-deep-search-round":
    case "generate-idea-research-prompts":
    case "generate-ideas":
    case "evaluate-idea":
    case "select-ideas":
    case "refine-idea":
    case "create-idea-site":
    case "debate-opening":
    case "debate-rebuttal":
    case "debate-judge":
      return "big"
    default: {
      const exhaustive: never = promptName
      return exhaustive
    }
  }
}

function assignmentsFromRow(
  row: typeof llmModelSettings.$inferSelect,
): LlmModelAssignments {
  return {
    small: {
      provider: row.smallProvider,
      modelId: row.smallModelId,
      reasoningEffort: row.smallReasoningEffort,
    },
    big: {
      provider: row.bigProvider,
      modelId: row.bigModelId,
      reasoningEffort: row.bigReasoningEffort,
    },
  }
}

export function getStoredLlmModelAssignments(
  userId: string,
): LlmModelAssignments | undefined {
  const row = db
    .select()
    .from(llmModelSettings)
    .where(eq(llmModelSettings.userId, userId))
    .get()
  return row === undefined ? undefined : assignmentsFromRow(row)
}

export function replaceLlmModelAssignments(
  userId: string,
  assignments: LlmModelAssignments,
): boolean {
  return db.transaction((transaction) => {
    const selectsOpenAi =
      assignments.small.provider === "openai" ||
      assignments.big.provider === "openai"
    if (
      selectsOpenAi &&
      transaction
        .select({ userId: openAiCodexConnections.userId })
        .from(openAiCodexConnections)
        .where(eq(openAiCodexConnections.userId, userId))
        .get() === undefined
    ) {
      return false
    }

    transaction
      .insert(llmModelSettings)
      .values({
        userId,
        smallProvider: assignments.small.provider,
        smallModelId: assignments.small.modelId,
        smallReasoningEffort: assignments.small.reasoningEffort,
        bigProvider: assignments.big.provider,
        bigModelId: assignments.big.modelId,
        bigReasoningEffort: assignments.big.reasoningEffort,
      })
      .onConflictDoUpdate({
        target: llmModelSettings.userId,
        set: {
          smallProvider: assignments.small.provider,
          smallModelId: assignments.small.modelId,
          smallReasoningEffort: assignments.small.reasoningEffort,
          bigProvider: assignments.big.provider,
          bigModelId: assignments.big.modelId,
          bigReasoningEffort: assignments.big.reasoningEffort,
        },
      })
      .run()
    return true
  })
}

export type LlmModelAssignmentSnapshot = {
  role: LlmModelRole
  assignment: LlmModelAssignment
  explicit: boolean
}

/** Reads the role choice once, before provider reservation or queue admission. */
export function snapshotLlmModelAssignment(
  userId: string,
  promptName: PromptName,
): LlmModelAssignmentSnapshot {
  const role = modelRoleForPrompt(promptName)
  const stored = getStoredLlmModelAssignments(userId)
  if (stored) return { role, assignment: stored[role], explicit: true }

  const recommended = hasOpenAiCodexConnection(userId)
    ? openAiRecommendedAssignments
    : deepSeekRecommendedAssignments
  return { role, assignment: recommended[role], explicit: false }
}

/** Deletes the credential and rewrites only OpenAI-backed explicit choices. */
export function disconnectOpenAiAndResetModelAssignments(userId: string): void {
  db.transaction((transaction) => {
    const row = transaction
      .select()
      .from(llmModelSettings)
      .where(eq(llmModelSettings.userId, userId))
      .get()

    transaction
      .delete(openAiCodexConnections)
      .where(eq(openAiCodexConnections.userId, userId))
      .run()

    if (!row) return
    const current = assignmentsFromRow(row)
    const small = current.small.provider === "openai"
      ? deepSeekRecommendedAssignments.small
      : current.small
    const big = current.big.provider === "openai"
      ? deepSeekRecommendedAssignments.big
      : current.big
    transaction
      .update(llmModelSettings)
      .set({
        smallProvider: small.provider,
        smallModelId: small.modelId,
        smallReasoningEffort: small.reasoningEffort,
        bigProvider: big.provider,
        bigModelId: big.modelId,
        bigReasoningEffort: big.reasoningEffort,
      })
      .where(eq(llmModelSettings.userId, userId))
      .run()
  })
}
