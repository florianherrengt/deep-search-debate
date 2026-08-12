import { beforeEach, describe, expect, it, vi } from "vitest"

const mocks = vi.hoisted(() => ({
  generateObjectStream: vi.fn(),
}))

vi.mock("../../llms/generateText.ts", () => ({
  generateObjectStream: mocks.generateObjectStream,
}))

import { roundReviewSchema, startRoundReview } from "./reviewRound.ts"
import { config } from "../../config.ts"

describe("deep-search round review", () => {
  beforeEach(() => vi.clearAllMocks())

  it("registers a structured decision over all accumulated evidence", async () => {
    const onCompleted = vi.fn()
    const onRegistered = vi.fn()
    mocks.generateObjectStream.mockResolvedValueOnce({
      id: "review-stream-id",
      completion: Promise.resolve({
        status: "completed",
        text: JSON.stringify({
          decision: "continue",
          reason: "A primary-source gap remains.",
        }),
        reasoning: "",
      }),
      output: Promise.resolve({
        decision: "continue",
        reason: "A primary-source gap remains.",
      }),
    })

    const review = await startRoundReview({
      userId: "test-user-id",
      deepSearchJobId: "deep-search-job-id",
      researchRequest: "Research this",
      candidateAnswer: "The current answer covers the market but not its risks.",
      completedRound: 1,
      maxRounds: 3,
      searchSummaries: [
        { round: 0, query: "first query", content: "First findings" },
        { round: 1, query: "second query", content: "Second findings" },
      ],
      onCompleted,
      onRegistered,
    })

    expect(review.streamId).toBe("review-stream-id")
    await expect(review.review).resolves.toEqual({
      decision: "continue",
      reason: "A primary-source gap remains.",
    })
    expect(mocks.generateObjectStream).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: "test-user-id",
        owner: { deepSearchJobId: "deep-search-job-id" },
        promptName: "review-deep-search-round",
        schema: roundReviewSchema,
        reasoning: "enabled",
        onCompleted,
        onRegistered,
      }),
    )
    const call = mocks.generateObjectStream.mock.calls[0]?.[0] as
      | { prompt: string; maxOutputTokens?: number }
      | undefined
    expect(call).toBeDefined()
    if (!call) throw new Error("generateObjectStream was not called")
    expect(call.maxOutputTokens).toBe(1_024)
    expect(call.prompt).toContain("completed_rounds: 2")
    expect(call.prompt).toContain("maximum_rounds: 3")
    expect(call.prompt).toContain("<candidate_answer>")
    expect(call.prompt).toContain(
      "The current answer covers the market but not its risks.",
    )
    expect(call.prompt).toContain('search_summary round="1"')
    expect(call.prompt).toContain("First findings")
    expect(call.prompt).toContain('search_summary round="2"')
    expect(call.prompt).toContain("Second findings")
  })

  it("rejects an invalid or empty decision reason", () => {
    expect(
      roundReviewSchema.safeParse({ decision: "continue", reason: "" })
        .success,
    ).toBe(false)
    expect(
      roundReviewSchema.safeParse({ decision: "unknown", reason: "Gap" })
        .success,
    ).toBe(false)
  })

  it("bounds accumulated evidence while preserving every round", async () => {
    mocks.generateObjectStream.mockResolvedValueOnce({
      id: "review-stream-id",
      completion: Promise.resolve({
        status: "completed",
        text: JSON.stringify({ decision: "stop", reason: "Enough evidence" }),
        reasoning: "",
      }),
      output: Promise.resolve({ decision: "stop", reason: "Enough evidence" }),
    })

    await startRoundReview({
      userId: "test-user-id",
      deepSearchJobId: "deep-search-job-id",
      researchRequest: "Research this",
      candidateAnswer: "Current answer",
      completedRound: 1,
      maxRounds: 3,
      searchSummaries: [
        { round: 0, query: "first evidence", content: "a".repeat(100_000) },
        { round: 1, query: "second evidence", content: "b".repeat(100_000) },
      ],
    })

    const prompt = (mocks.generateObjectStream.mock.calls[0]?.[0] as {
      prompt: string
    }).prompt
    const context = /<search_summaries>\n([\s\S]*)\n<\/search_summaries>/.exec(
      prompt,
    )?.[1]
    expect(context).toBeDefined()
    expect(context?.length).toBeLessThanOrEqual(
      config.deepSearch.maxSummaryContextChars,
    )
    expect(context).toContain('<search_summary round="1">')
    expect(context).toContain('<search_summary round="2">')
  })
})
