import { afterEach, beforeEach, describe, expect, it } from "vitest"

import { db } from "../db/index.ts"
import {
  llmModelSettings,
  openAiCodexConnections,
} from "../db/schema/index.ts"
import { PromptName } from "./prompts.ts"
import {
  deepSeekRecommendedAssignments,
  disconnectOpenAiAndResetModelAssignments,
  getStoredLlmModelAssignments,
  modelRoleForPrompt,
  replaceLlmModelAssignments,
  snapshotLlmModelAssignment,
} from "./modelSettings.ts"

const userId = "test-user-id"

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
      "select-websearch-results": "small",
      "select-linked-pages": "small",
      "summarize-web-page": "small",
      "summarize-search-query": "small",
      "summarize-idea-research": "small",
      default: "big",
      "generate-websearch-queries": "big",
      "answer-research-request": "big",
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
    })
  })

  it("uses DeepSeek recommendations when no row or connection exists", () => {
    expect(
      snapshotLlmModelAssignment(userId, PromptName.GeneratePromptTitle),
    ).toEqual({
      role: "small",
      assignment: deepSeekRecommendedAssignments.small,
      explicit: false,
    })
    expect(snapshotLlmModelAssignment(userId, PromptName.DebateJudge)).toEqual({
      role: "big",
      assignment: deepSeekRecommendedAssignments.big,
      explicit: false,
    })
  })

  it("reads a successfully replaced role on the next invocation", () => {
    const first = {
      small: deepSeekRecommendedAssignments.small,
      big: deepSeekRecommendedAssignments.big,
    }
    expect(replaceLlmModelAssignments(userId, first)).toBe(true)
    expect(snapshotLlmModelAssignment(userId, PromptName.DebateOpening))
      .toMatchObject({ assignment: first.big, explicit: true })

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
      .toMatchObject({ assignment: next.big, explicit: true })
  })

  it("requires an OpenAI connection in the same transaction as replacement", () => {
    expect(
      replaceLlmModelAssignments(userId, {
        small: deepSeekRecommendedAssignments.small,
        big: {
          provider: "openai",
          modelId: "gpt-5.6-sol",
          reasoningEffort: "xhigh",
        },
      }),
    ).toBe(false)
    expect(getStoredLlmModelAssignments(userId)).toBeUndefined()
  })

  it("disconnects and resets only OpenAI-backed roles atomically", () => {
    insertConnection()
    expect(
      replaceLlmModelAssignments(userId, {
        small: {
          provider: "deepseek",
          modelId: "deepseek-v4-pro",
          reasoningEffort: "low",
        },
        big: {
          provider: "openai",
          modelId: "gpt-5.6-sol",
          reasoningEffort: "xhigh",
        },
      }),
    ).toBe(true)

    disconnectOpenAiAndResetModelAssignments(userId)

    expect(db.select().from(openAiCodexConnections).all()).toEqual([])
    expect(getStoredLlmModelAssignments(userId)).toEqual({
      small: {
        provider: "deepseek",
        modelId: "deepseek-v4-pro",
        reasoningEffort: "low",
      },
      big: deepSeekRecommendedAssignments.big,
    })
  })
})
