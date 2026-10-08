import { eq } from "drizzle-orm"
import z from "zod"

import { db } from "../db/index.ts"
import {
  llmModelProviders,
  llmModelSettings,
  llmReasoningEfforts,
  openAiCodexConnections,
} from "../db/schema/index.ts"
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

export function modelRoleForPrompt(promptName: PromptName): LlmModelRole {
  switch (promptName) {
    case "generate-prompt-title":
    case "select-websearch-results":
    case "select-linked-pages":
    case "summarize-web-page":
    case "summarize-search-query":
    case "summarize-idea-research":
    case "select-discovery-results":
    case "select-discovery-links":
    case "summarize-discovery-page":
    case "summarize-discovery-query":
      return "small"
    case "default":
    case "generate-websearch-queries":
    case "generate-discovery-queries":
    case "update-discovery-inventory":
    case "review-discovery-round":
    case "answer-research-request":
    case "correct-research-answer":
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
}

export class ModelSelectionRequiredError extends Error {
  readonly code = "model-selection-required"

  constructor() {
    super("Choose Small and Big models before starting.")
    this.name = "ModelSelectionRequiredError"
  }
}

/** Reads the role choice once, before provider reservation or queue admission. */
export function snapshotLlmModelAssignment(
  userId: string,
  promptName: PromptName,
): LlmModelAssignmentSnapshot {
  const role = modelRoleForPrompt(promptName)
  const stored = getStoredLlmModelAssignments(userId)
  if (stored) return { role, assignment: stored[role] }
  throw new ModelSelectionRequiredError()
}

/** Deletes the OpenAI credential without changing the user's model choices. */
export function disconnectOpenAiAndResetModelAssignments(userId: string): void {
  db.transaction((transaction) => {
    transaction
      .delete(openAiCodexConnections)
      .where(eq(openAiCodexConnections.userId, userId))
      .run()
  })
}
