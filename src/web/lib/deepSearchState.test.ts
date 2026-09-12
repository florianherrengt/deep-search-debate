import { describe, expect, it } from "vitest"
import type { DeepSearchJobEvent } from "./deepSearchJobs.ts"
import {
  deepSearchReducer,
  initialDeepSearchState,
} from "./deepSearchState.ts"

const result = {
  title: "Result",
  shortText: "Useful evidence",
  link: "https://example.com/evidence",
}

const researchAnalysis = {
  facts: [
    {
      title: "Supported finding",
      description: "The evidence supports this finding.",
      sources: [result.link],
    },
  ],
  disagreements: [],
  gaps: [],
  assumptions: [],
}

describe("deep-search state", () => {
  it("replays round coverage idempotently and keeps correction provisional until done", () => {
    const requirements = [{ requirement: "Verify eligibility", kind: "requirement" as const, status: "unresolved" as const, sources: [], explanation: "The eligibility terms still need checking." }]
    const event: DeepSearchJobEvent = { type: "research-requirements", round: 1, requirements }
    let state = deepSearchReducer(initialDeepSearchState, { type: "opened" })
    state = deepSearchReducer(deepSearchReducer(state, event), event)
    state = deepSearchReducer(state, { type: "research-requirements", round: 0, requirements: [] })
    expect(state.roundRequirements).toEqual([{ round: 0, requirements: [] }, { round: 1, requirements }])
    state = deepSearchReducer(state, { type: "final-answer-stream", streamId: "correction" })
    expect(state.status).toBe("running")
    const analysis = { ...researchAnalysis, requirements: [{ ...requirements[0], status: "supported" as const, sources: [result.link] }] }
    state = deepSearchReducer(state, { type: "research-analysis", analysis })
    expect(state.status).toBe("running")
    expect(state.researchAnalysis).toEqual(analysis)
    expect(deepSearchReducer(state, { type: "done" }).status).toBe("completed")
    expect(deepSearchReducer(deepSearchReducer(state, { type: "error", message: "Correction failed" }), { type: "done" }).status).toBe("failed")
    expect(deepSearchReducer(state, { type: "opened" }).roundRequirements).toEqual([])
  })

  it("replays linked provenance and shares retained findings across parents and search rounds", () => {
    const target = "https://example.com/terms"
    const selection: DeepSearchJobEvent = {
      type: "selected-linked-pages",
      sourceUrl: result.link,
      links: [{ url: target, title: "Terms" }],
    }
    const events: DeepSearchJobEvent[] = [
      { type: "search-results", round: 0, searches: [{ query: "first", results: [result] }] },
      { type: "selected-search-results", round: 0, query: "first", selectedLinks: [result.link] },
      { type: "linked-page-selection-stream", sourceUrl: result.link, streamId: "linked-selection" },
      selection,
      { type: "selected-linked-pages", sourceUrl: "https://example.com/other", links: [{ url: target, title: "Plan terms" }] },
      { type: "page-summary-stream", url: target, streamId: "terms-summary" },
      selection,
      { type: "linked-page-selection-stream", sourceUrl: result.link, streamId: "linked-selection" },
      { type: "search-results", round: 1, searches: [{ query: "follow-up", results: [{ ...result, link: target }] }] },
      { type: "selected-search-results", round: 1, query: "follow-up", selectedLinks: [target] },
    ]
    const state = events.reduce(deepSearchReducer, deepSearchReducer(initialDeepSearchState, { type: "opened" }))

    expect(state.linkedSources).toEqual([
      { sourceUrl: result.link, selectionStreamId: "linked-selection", links: [{ url: target, title: "Terms", summary: { status: "stream", streamId: "terms-summary" } }] },
      { sourceUrl: "https://example.com/other", links: [{ url: target, title: "Plan terms", summary: { status: "stream", streamId: "terms-summary" } }] },
    ])
    expect(state.searches[1].results[0].summary).toEqual({ status: "stream", streamId: "terms-summary" })

    const failed = deepSearchReducer(state, { type: "page-summary-error", url: target, stage: "summary", message: "Summary unavailable" })
    expect(failed.linkedSources.map((source) => source.links?.[0].summary)).toEqual([
      { status: "error", message: "Summary unavailable" },
      { status: "error", message: "Summary unavailable" },
    ])
    expect(failed.searches[1].results[0].summary).toEqual({ status: "error", message: "Summary unavailable" })

    const reopened = deepSearchReducer(failed, { type: "opened" })
    expect(reopened.linkedSources).toEqual([])
    expect(events.reduce(deepSearchReducer, reopened)).toEqual(state)
  })

  it("distinguishes unfinished link selection from completed empty selection", () => {
    const selecting = deepSearchReducer(initialDeepSearchState, {
      type: "linked-page-selection-stream", sourceUrl: result.link, streamId: "selector",
    })
    expect(selecting.linkedSources[0].links).toBeUndefined()
    const selected = deepSearchReducer(selecting, { type: "selected-linked-pages", sourceUrl: result.link, links: [] })
    expect(selected.linkedSources).toEqual([{ sourceUrl: result.link, selectionStreamId: "selector", links: [] }])
  })

  it("retains independently keyed progress across search rounds", () => {
    const events = [
      { type: "opened" as const },
      {
        type: "query-stream" as const,
        round: 0,
        streamId: "query-0",
      },
      {
        type: "search-results" as const,
        round: 0,
        searches: [{ query: "first query", results: [result] }],
      },
      {
        type: "selected-search-results" as const,
        round: 0,
        query: "first query",
        selectedLinks: [result.link],
      },
      {
        type: "page-summary-stream" as const,
        url: result.link,
        streamId: "page-summary",
      },
      {
        type: "query-summary-stream" as const,
        round: 0,
        query: "first query",
        streamId: "summary-0",
      },
      {
        type: "round-answer-stream" as const,
        round: 0,
        streamId: "answer-0",
      },
      {
        type: "round-review-stream" as const,
        round: 0,
        streamId: "review-0",
      },
      {
        type: "round-review" as const,
        round: 0,
        decision: "continue" as const,
        reason: "A gap remains.",
      },
      {
        type: "query-stream" as const,
        round: 1,
        streamId: "query-1",
      },
      {
        type: "search-results" as const,
        round: 1,
        searches: [{ query: "second query", results: [result] }],
      },
      {
        type: "selected-search-results" as const,
        round: 1,
        query: "second query",
        selectedLinks: [result.link],
      },
      {
        type: "round-answer-stream" as const,
        round: 1,
        streamId: "answer-1",
      },
      {
        type: "round-review" as const,
        round: 1,
        decision: "stop" as const,
        reason: "The evidence is sufficient.",
      },
      { type: "research-analysis" as const, analysis: researchAnalysis },
      { type: "done" as const },
    ]

    const state = events.reduce(deepSearchReducer, initialDeepSearchState)

    expect(state.status).toBe("completed")
    expect(state.queryGenerations).toEqual([
      { round: 0, streamId: "query-0" },
      { round: 1, streamId: "query-1" },
    ])
    expect(state.roundAnswers).toEqual([
      { round: 0, streamId: "answer-0" },
      { round: 1, streamId: "answer-1" },
    ])
    expect(state.searches).toMatchObject([
      {
        round: 0,
        query: "first query",
        querySummaryStreamId: "summary-0",
        results: [
          {
            selection: "selected",
            summary: { status: "stream", streamId: "page-summary" },
          },
        ],
      },
      {
        round: 1,
        query: "second query",
        results: [
          {
            selection: "selected",
            summary: { status: "stream", streamId: "page-summary" },
          },
        ],
      },
    ])
    expect(state.roundReviews).toEqual([
      {
        round: 0,
        streamId: "review-0",
        status: "continue",
        reason: "A gap remains.",
      },
      {
        round: 1,
        status: "stop",
        reason: "The evidence is sufficient.",
      },
    ])
    expect(state.researchAnalysis).toEqual(researchAnalysis)
  })

  it("records optional review failure without failing the research job", () => {
    const running = deepSearchReducer(initialDeepSearchState, {
      type: "opened",
    })
    const reviewed = deepSearchReducer(running, {
      type: "round-review-error",
      round: 0,
      message: "Review unavailable",
    })

    expect(reviewed.status).toBe("running")
    expect(reviewed.roundReviews).toEqual([
      {
        round: 0,
        status: "error",
        reason: "Review unavailable",
      },
    ])
  })

  it("keeps Stop idempotent and preserves the interrupted terminal state", () => {
    const events = [
      { type: "opened" as const },
      { type: "stop-requested" as const },
      { type: "stop-requested" as const },
      {
        type: "interrupted" as const,
        message: "Workflow stopped by user",
      },
      { type: "done" as const },
      { type: "done" as const },
    ]

    const state = events.reduce(deepSearchReducer, initialDeepSearchState)

    expect(state.status).toBe("interrupted")
    expect(state.error).toBe("Workflow stopped by user")
  })
})
