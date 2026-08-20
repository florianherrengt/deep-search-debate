import { describe, expect, it } from "vitest"
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
