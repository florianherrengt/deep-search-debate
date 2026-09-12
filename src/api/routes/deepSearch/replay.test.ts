import { beforeEach, describe, expect, it } from "vitest"

import { db } from "../../db/index.ts"
import {
  deepSearchJobs,
  deepSearchPageLinks,
  deepSearchRounds,
  deepSearchWebPages,
  llmGenerations,
} from "../../db/schema/index.ts"
import { reconstructDeepSearchJobEvents } from "./replay.ts"

const analysis = {
  facts: [
    {
      title: "Supported finding",
      description: "The supplied evidence supports the finding.",
      sources: ["https://example.com/evidence"],
    },
  ],
  disagreements: [],
  gaps: [],
  assumptions: [],
}

function completeJob(analysisText: string): string {
  const jobId = crypto.randomUUID()
  const answerGenerationId = crypto.randomUUID()
  const analysisGenerationId = crypto.randomUUID()
  db.insert(deepSearchJobs)
    .values({
      deepSearchJobId: jobId,
      userId: "test-user-id",
      slug: `job-${jobId}`,
      researchRequest: "Research this",
      maxSearches: 1,
      maxResultsPerSearch: 1,
      strictQuality: false,
    })
    .run()
  db.insert(llmGenerations)
    .values([
      {
        llmGenerationId: answerGenerationId,
        userId: "test-user-id",
        deepSearchJobId: jobId,
        status: "completed",
        text: "Completed answer",
        reasoning: "",
        completedAt: new Date(),
      },
      {
        llmGenerationId: analysisGenerationId,
        userId: "test-user-id",
        deepSearchJobId: jobId,
        status: "completed",
        text: analysisText,
        reasoning: "",
        completedAt: new Date(),
      },
    ])
    .run()
  db.update(deepSearchJobs)
    .set({
      finalAnswerGenerationId: answerGenerationId,
      researchAnalysisGenerationId: analysisGenerationId,
      status: "completed",
      completedAt: new Date(),
    })
    .run()
  return jobId
}

describe("deep-search replay", () => {
  beforeEach(() => {
    db.delete(deepSearchJobs).run()
    db.delete(llmGenerations).run()
  })

  it.each([
    { legacyFormat: "persisted generateArrayStream object", legacyText: '{"elements":["Legacy query"]}' },
    { legacyFormat: "bare array", legacyText: '["Legacy query"]' },
  ])("replays each plan and review checklist without inventing requirements for a legacy $legacyFormat", ({ legacyText }) => {
    const jobId = completeJob(JSON.stringify(analysis))
    const initial = [{ requirement: "Establish eligibility", kind: "requirement", status: "unresolved", sources: [], explanation: "The qualifying conditions have not been read." }]
    const conflicting = [{ ...initial[0], status: "conflicting", sources: ["https://example.com/offer", "https://example.com/terms"], explanation: "The advertised offer and its terms disagree." }]
    const updated = [{ ...conflicting[0], explanation: "Resolve the existing-customer exclusion." }]
    const supported = [{ ...initial[0], status: "supported", sources: ["https://example.com/terms"], explanation: "The current terms explicitly exclude existing customers." }]
    const rounds = [
      { position: 1, plan: updated, review: supported, decision: "stop" as const },
      { position: 0, plan: initial, review: conflicting, decision: "continue" as const },
    ]
    for (const round of rounds) {
      const planId = crypto.randomUUID()
      const reviewId = crypto.randomUUID()
      db.insert(llmGenerations).values([
        { llmGenerationId: planId, userId: "test-user-id", deepSearchJobId: jobId, status: "completed", text: JSON.stringify({ version: 1, queries: ["Check eligibility"], requirements: round.plan }), reasoning: "", completedAt: new Date() },
        { llmGenerationId: reviewId, userId: "test-user-id", deepSearchJobId: jobId, status: "completed", text: JSON.stringify({ decision: round.decision, reason: "Check the eligibility evidence.", requirements: round.review }), reasoning: "", completedAt: new Date() },
      ]).run()
      db.insert(deepSearchRounds).values({ deepSearchRoundId: crypto.randomUUID(), deepSearchJobId: jobId, position: round.position, llmGenerationId: planId, reviewGenerationId: reviewId, reviewDecision: round.decision, reviewReason: "Check the eligibility evidence.", reviewCompletedAt: new Date() }).run()
    }
    const legacyId = crypto.randomUUID()
    db.insert(llmGenerations).values({ llmGenerationId: legacyId, userId: "test-user-id", deepSearchJobId: jobId, status: "completed", text: legacyText, reasoning: "", completedAt: new Date() }).run()
    db.insert(deepSearchRounds).values({ deepSearchRoundId: crypto.randomUUID(), deepSearchJobId: jobId, position: 2, llmGenerationId: legacyId }).run()

    expect(reconstructDeepSearchJobEvents(jobId)?.filter((event) => event.type === "research-requirements")).toEqual([
      { type: "research-requirements", round: 0, requirements: initial },
      { type: "research-requirements", round: 0, requirements: conflicting },
      { type: "research-requirements", round: 1, requirements: updated },
      { type: "research-requirements", round: 1, requirements: supported },
    ])
  })

  it("reconstructs the validated research analysis before the terminal event", () => {
    const jobId = completeJob(JSON.stringify(analysis))

    expect(reconstructDeepSearchJobEvents(jobId)).toEqual([
      expect.objectContaining({ type: "final-answer-stream" }),
      { type: "research-analysis", analysis },
      { type: "done" },
    ])
  })

  it("does not expose malformed persisted structured output", () => {
    const jobId = completeJob('{"facts":"invalid"}')

    expect(reconstructDeepSearchJobEvents(jobId)).toEqual([
      expect.objectContaining({ type: "final-answer-stream" }),
      { type: "done" },
    ])
  })

  it("replays linked-source provenance before summaries and unavailable destinations", () => {
    const jobId = completeJob(JSON.stringify(analysis))
    const sourceId = crypto.randomUUID()
    const targetId = crypto.randomUUID()
    const roundId = crypto.randomUUID()
    const planningId = crypto.randomUUID()
    const selectorId = crypto.randomUUID()
    const summaryId = crypto.randomUUID()
    const linkId = crypto.randomUUID()
    db.insert(llmGenerations).values([planningId, selectorId, summaryId].map((llmGenerationId) => ({ llmGenerationId, userId: "test-user-id", deepSearchJobId: jobId, status: "completed" as const, text: llmGenerationId === selectorId ? JSON.stringify({ selectedIds: [linkId] }) : "Completed output", reasoning: "", completedAt: new Date() }))).run()
    db.insert(deepSearchRounds).values({ deepSearchRoundId: roundId, deepSearchJobId: jobId, position: 0, llmGenerationId: planningId }).run()
    db.insert(deepSearchWebPages).values([
      { deepSearchWebPageId: sourceId, deepSearchJobId: jobId, url: "https://example.com/source", status: "completed", summaryGenerationId: summaryId, linkSelectionGenerationId: selectorId, completedAt: new Date() },
      { deepSearchWebPageId: targetId, deepSearchJobId: jobId, url: "https://example.com/linked", status: "failed", errorStage: "extraction", errorMessage: "Linked source unavailable", completedAt: new Date() },
    ]).run()
    db.insert(deepSearchPageLinks).values({ deepSearchPageLinkId: linkId, sourceWebPageId: sourceId, position: 0, url: "https://example.com/linked", title: "Linked primary source", selectedWebPageId: targetId, selectedRoundId: roundId }).run()

    const events = reconstructDeepSearchJobEvents(jobId)!
    expect(events).toContainEqual({ type: "linked-page-selection-stream", sourceUrl: "https://example.com/source", streamId: selectorId })
    const selection = { type: "selected-linked-pages", sourceUrl: "https://example.com/source", links: [{ url: "https://example.com/linked", title: "Linked primary source" }] }
    expect(events).toContainEqual(selection)
    expect(events).toContainEqual({ type: "page-summary-error", url: "https://example.com/linked", stage: "extraction", message: "Linked source unavailable" })
    expect(events.findIndex((event) => event.type === "selected-linked-pages")).toBeLessThan(events.findIndex((event) => event.type === "page-summary-stream"))
    expect(events.findIndex((event) => event.type === "selected-linked-pages")).toBeLessThan(events.findIndex((event) => event.type === "page-summary-error"))
    expect(events.filter((event) => event.type === "search-results")).toEqual([])
  })

  it("replays an empty completed link selection without inventing a round", () => {
    const jobId = completeJob(JSON.stringify(analysis))
    const selectorId = crypto.randomUUID()
    db.insert(llmGenerations).values({ llmGenerationId: selectorId, userId: "test-user-id", deepSearchJobId: jobId, status: "completed", text: '{"selectedIds":[]}', reasoning: "", completedAt: new Date() }).run()
    db.insert(deepSearchWebPages).values({ deepSearchWebPageId: crypto.randomUUID(), deepSearchJobId: jobId, url: "https://example.com/source", status: "failed", errorStage: "extraction", errorMessage: "Unavailable", completedAt: new Date(), linkSelectionGenerationId: selectorId }).run()
    expect(reconstructDeepSearchJobEvents(jobId)).toContainEqual({ type: "selected-linked-pages", sourceUrl: "https://example.com/source", links: [] })
  })
})
