import { eq, inArray } from "drizzle-orm"
import { afterEach, beforeEach, describe, expect, it } from "vitest"

import { db } from "../db/index.ts"
import {
  deepSearchJobs,
  llmModelSettings,
  openAiCodexConnections,
  refineBatches,
  refineSearchLinks,
  refineSessions,
} from "../db/schema/index.ts"
import { PromptName } from "./prompts.ts"
import {
  disconnectOpenAiAndResetModelAssignments,
  getStoredLlmModelAssignments,
  modelRoleForPrompt,
  replaceLlmModelAssignments,
  ModelSelectionRequiredError,
  snapshotLlmModelAssignment,
} from "./modelSettings.ts"

const userId = "test-user-id"
const refineSessionId = "model-settings-refine-session"
const refineBatchId = "model-settings-refine-batch"
const preparationJobId = "model-settings-preparation-job"
const researchJobId = "model-settings-research-job"

function insertLinkedDeepSearches(): void {
  db.insert(refineSessions).values({
    refineSessionId,
    userId,
    originalPrompt: "Clarify a research request",
    status: "research-started",
    activeBatchId: null,
    finalDeepSearchJobId: researchJobId,
    finalResearchRequest: "Complete the final research",
  }).run()
  db.insert(refineBatches).values({
    refineBatchId,
    refineSessionId,
    position: 0,
    status: "ready",
  }).run()
  db.update(refineSessions).set({ activeBatchId: refineBatchId })
    .where(eq(refineSessions.refineSessionId, refineSessionId)).run()
  for (const [deepSearchJobId, role] of [
    [preparationJobId, "preparation"],
    [researchJobId, "research"],
  ] as const) {
    db.insert(deepSearchJobs).values({
      deepSearchJobId,
      userId,
      title: role,
      slug: `model-settings-${role}`,
      researchRequest: role,
      maxSearches: 1,
      maxResultsPerSearch: 1,
      maxRounds: 1,
      strictQuality: false,
      status: "running",
      finalAnswerGenerationId: null,
    }).run()
    db.insert(refineSearchLinks).values({
      refineSearchLinkId: `model-settings-${role}-link`,
      refineSessionId,
      refineBatchId: role === "preparation" ? refineBatchId : null,
      deepSearchJobId,
      userId,
      role,
      position: role === "preparation" ? 0 : null,
    }).run()
  }
}

function insertConnection(): void {
  db.insert(openAiCodexConnections)
    .values({
      userId,
      connectionId: crypto.randomUUID(),
      credentialsCiphertext: Buffer.from("ciphertext"),
      credentialsNonce: Buffer.alloc(12),
      credentialsAuthenticationTag: Buffer.alloc(16),
    })
    .run()
}

beforeEach(() => {
  db.delete(llmModelSettings).run()
  db.delete(openAiCodexConnections).run()
})

afterEach(() => {
  db.delete(refineSessions).where(eq(refineSessions.refineSessionId, refineSessionId)).run()
  db.delete(deepSearchJobs).where(inArray(deepSearchJobs.deepSearchJobId, [preparationJobId, researchJobId])).run()
  db.delete(llmModelSettings).run()
  db.delete(openAiCodexConnections).run()
})

describe("LLM model settings", () => {
  it("maps every prompt to its confirmed role", () => {
    const roles = Object.fromEntries(
      Object.values(PromptName).map((promptName) => [
        promptName,
        modelRoleForPrompt(promptName),
      ]),
    )
    expect(roles).toEqual({
      "generate-prompt-title": "small",
      "select-discovery-results": "small",
      "select-discovery-links": "small",
      "summarize-discovery-page": "small",
      "summarize-discovery-query": "small",
      "generate-discovery-queries": "big",
      "update-discovery-inventory": "big",
      "review-discovery-round": "big",
      "select-websearch-results": "small",
      "select-linked-pages": "small",
      "summarize-web-page": "small",
      "summarize-search-query": "small",
      "summarize-idea-research": "small",
      default: "big",
      "generate-websearch-queries": "big",
      "answer-research-request": "big",
      "browser-agent-action": "small",
      "correct-research-answer": "big",
      "analyze-research-answer": "big",
      "review-deep-search-round": "big",
      "generate-idea-research-prompts": "big",
      "generate-ideas": "big",
      "evaluate-idea": "big",
      "select-ideas": "big",
      "refine-idea": "big",
      "create-idea-site": "big",
      "debate-opening": "big",
      "debate-rebuttal": "big",
      "debate-judge": "big",
      "refine-generate-questions": "small",
      "refine-condense-research-request": "small",
    })
  })

  it("requires saved assignments before taking a prompt model snapshot", () => {
    expect(() =>
      snapshotLlmModelAssignment(userId, PromptName.GeneratePromptTitle),
    ).toThrow(ModelSelectionRequiredError)
    expect(() =>
      snapshotLlmModelAssignment(userId, PromptName.DebateJudge),
    ).toThrow(expect.objectContaining({
      code: "model-selection-required",
      name: "ModelSelectionRequiredError",
    }))
  })

  it("reads a successfully replaced role on the next invocation", () => {
    const first = {
      small: {
        provider: "deepseek" as const,
        modelId: "deepseek-v4-flash",
        reasoningEffort: "medium" as const,
      },
      big: {
        provider: "deepseek" as const,
        modelId: "deepseek-v4-pro",
        reasoningEffort: "xhigh" as const,
      },
    }
    expect(replaceLlmModelAssignments(userId, first)).toBe(true)
    expect(snapshotLlmModelAssignment(userId, PromptName.DebateOpening))
      .toMatchObject({ assignment: first.big })

    const next = {
      small: {
        provider: "deepseek" as const,
        modelId: "deepseek-v4-pro",
        reasoningEffort: "none" as const,
      },
      big: {
        provider: "deepseek" as const,
        modelId: "deepseek-v4-flash",
        reasoningEffort: "high" as const,
      },
    }
    expect(replaceLlmModelAssignments(userId, next)).toBe(true)
    expect(snapshotLlmModelAssignment(userId, PromptName.DebateOpening))
      .toMatchObject({ assignment: next.big })
  })

  it("uses the current Small assignment for preparation work and Big for the linked research job", () => {
    const assignments = {
      small: {
        provider: "deepseek" as const,
        modelId: "deepseek-v4-flash",
        reasoningEffort: "low" as const,
      },
      big: {
        provider: "openai" as const,
        modelId: "gpt-5.6-sol",
        reasoningEffort: "xhigh" as const,
      },
    }
    insertConnection()
    expect(replaceLlmModelAssignments(userId, assignments)).toBe(true)
    insertLinkedDeepSearches()

    expect(snapshotLlmModelAssignment(
      userId,
      PromptName.GenerateWebSearchQueries,
      preparationJobId,
    )).toEqual({ role: "small", assignment: assignments.small })
    expect(snapshotLlmModelAssignment(
      userId,
      PromptName.GenerateWebSearchQueries,
      researchJobId,
    )).toEqual({ role: "big", assignment: assignments.big })
    expect(snapshotLlmModelAssignment(
      userId,
      PromptName.GenerateWebSearchQueries,
    )).toEqual({ role: "big", assignment: assignments.big })
    expect(snapshotLlmModelAssignment(
      userId,
      PromptName.RefineGenerateQuestions,
    )).toEqual({ role: "small", assignment: assignments.small })
    expect(snapshotLlmModelAssignment(
      userId,
      PromptName.RefineCondenseResearchRequest,
    )).toEqual({ role: "small", assignment: assignments.small })
  })

  it("requires an OpenAI connection in the same transaction as replacement", () => {
    expect(
      replaceLlmModelAssignments(userId, {
        small: {
          provider: "deepseek",
          modelId: "deepseek-v4-flash",
          reasoningEffort: "medium",
        },
        big: {
          provider: "openai",
          modelId: "gpt-5.6-sol",
          reasoningEffort: "xhigh",
        },
      }),
    ).toBe(false)
    expect(getStoredLlmModelAssignments(userId)).toBeUndefined()
  })

  it("preserves explicit model choices when disconnecting OpenAI", () => {
    insertConnection()
    const assignments = {
      small: {
        provider: "deepseek" as const,
        modelId: "deepseek-v4-pro",
        reasoningEffort: "low" as const,
      },
      big: {
        provider: "openai" as const,
        modelId: "gpt-5.6-sol",
        reasoningEffort: "xhigh" as const,
      },
    }
    expect(replaceLlmModelAssignments(userId, assignments)).toBe(true)

    disconnectOpenAiAndResetModelAssignments(userId)

    expect(db.select().from(openAiCodexConnections).all()).toEqual([])
    expect(getStoredLlmModelAssignments(userId)).toEqual(assignments)
  })
})
