import { beforeEach, describe, expect, it, vi } from "vitest"

const mocks = vi.hoisted(() => ({
  generateObjectStream: vi.fn(),
}))

vi.mock("../../llms/generateText.ts", () => ({
  generateObjectStream: mocks.generateObjectStream,
}))

import { parseRoundReview, roundReviewSchema, startRoundReview } from "./reviewRound.ts"
import { config } from "../../config.ts"
import type { ZodType } from "zod"
import type { TextStreamPersistenceTransaction } from "../../llms/streams.ts"

describe("deep-search round review", () => {
  beforeEach(() => vi.clearAllMocks())

  it("registers a structured decision over all accumulated evidence", async () => {
    const onCompleted = vi.fn()
    const onRegistered = vi.fn()
    const requirements = [{ requirement: "Identify material risks", kind: "requirement" as const, status: "unresolved" as const, sources: [], explanation: "The risks need primary-source evidence." }]
    const rawReview = {
      version: 1,
      reason: "The candidate covers the main topic, but a decisive risk remains unverified.",
      requirements,
      gaps: [{ title: "Primary-source risk evidence", description: "The reported intervention has no verified safety qualification.", evidenceToFind: "Find the official intervention safety specification and its exclusions." }],
    }
    const rawText = JSON.stringify(rawReview)
    const transaction = {} as TextStreamPersistenceTransaction
    mocks.generateObjectStream.mockImplementationOnce((input: {
      onCompleted: (completed: { id: string; output: unknown }, transaction: TextStreamPersistenceTransaction) => void
    }) => {
      input.onCompleted({ id: "review-stream-id", output: rawReview }, transaction)
      return Promise.resolve({
        id: "review-stream-id",
        completion: Promise.resolve({ status: "completed", text: rawText, reasoning: "" }),
        output: Promise.resolve(rawReview),
      })
    })

    const review = await startRoundReview({
      userId: "test-user-id",
      deepSearchJobId: "deep-search-job-id",
      researchRequest: "Research this",
      candidateAnswer: "The current answer covers the market but not its risks.",
      completedRound: 1,
      maxRounds: 3,
      requirements,
      searchSummaries: [
        { round: 0, query: "first query", content: "First findings" },
        { round: 1, query: "second query", content: "Second findings" },
      ],
      onCompleted,
      onRegistered,
    })

    expect(review.streamId).toBe("review-stream-id")
    const effective = await review.review
    expect(effective).toMatchObject({ decision: "continue", requirements })
    expect(effective.reason).toContain(rawReview.gaps[0].description)
    expect(effective.reason).toContain(rawReview.gaps[0].evidenceToFind)
    expect(onCompleted).toHaveBeenCalledExactlyOnceWith({ id: "review-stream-id", output: effective }, transaction)
    await expect(review.completion).resolves.toMatchObject({ text: rawText })
    expect(JSON.parse(rawText)).not.toHaveProperty("decision")
    expect(mocks.generateObjectStream).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: "test-user-id",
        owner: { deepSearchJobId: "deep-search-job-id" },
        promptName: "review-deep-search-round",
        reasoning: "enabled",
        onRegistered,
      }),
    )
    const call = mocks.generateObjectStream.mock.calls[0]?.[0] as
      | { prompt: string; schema: ZodType }
      | undefined
    expect(call).toBeDefined()
    if (!call) throw new Error("generateObjectStream was not called")
    expect(call.schema.safeParse({ decision: "continue", reason: "A gap remains." }).success).toBe(false)
    expect(call.schema.parse(rawReview)).toEqual(rawReview)
    expect(call.schema.safeParse({ ...rawReview, gaps: [{ ...rawReview.gaps[0], evidenceToFind: "  " }] }).success).toBe(false)
    expect(call.schema.safeParse({ reason: rawReview.reason, requirements, gaps: [] }).success).toBe(false)
    expect(JSON.parse(/<requirements>\n([\s\S]*?)\n<\/requirements>/.exec(call.prompt)![1])).toEqual(requirements)
    expect(call).not.toHaveProperty("maxOutputTokens")
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

  it.each([
    { label: "no material gap", gaps: [] },
    { label: "a limitation without a useful external search", gaps: [{ title: "Future outcomes", description: "No source can establish a future result that has not occurred.", evidenceToFind: null }] },
  ])("stops for $label without inventing additional research", async ({ gaps }) => {
    const raw = { version: 1, reason: "Report the known limits of the evidence.", requirements: [], gaps }
    mocks.generateObjectStream.mockResolvedValueOnce({
      id: "review-stream-id",
      completion: Promise.resolve({ status: "completed", text: JSON.stringify(raw), reasoning: "" }),
      output: Promise.resolve(raw),
    })
    const review = await startRoundReview({ userId: "test-user-id", deepSearchJobId: "deep-search-job-id", researchRequest: "Research this", candidateAnswer: "Available findings.", completedRound: 0, maxRounds: 3, searchSummaries: [] })
    await expect(review.review).resolves.toMatchObject({ decision: "stop", reason: raw.reason })
  })

  it.each(["stop", "continue"])("preserves a legacy %s review without inventing gaps", (decision) => {
    const legacy = { decision, reason: "Previously recorded research outcome." }
    expect(parseRoundReview(legacy)).toEqual(legacy)
  })

  it.each([
    { version: 2, gaps: [] },
    { version: 1, gaps: [{ title: "Missing source", description: "A consequential condition remains unknown.", evidenceToFind: "  " }] },
    { version: 1, gaps: [{ title: "Missing source", description: "A consequential condition remains unknown." }] },
    { version: 1, gaps: [{ title: "Missing source", description: "A consequential condition remains unknown.", evidenceToFind: 42 }] },
    { version: 1, gaps: [{ title: "Missing source", description: "A consequential condition remains unknown.", evidenceToFind: "x".repeat(501) }] },
    { version: 1, gaps: [{ title: "x".repeat(161), description: "A consequential condition remains unknown.", evidenceToFind: null }] },
    { version: 1, gaps: [{ title: "Missing source", description: "x".repeat(2_001), evidenceToFind: null }] },
    { version: 1, gaps: Array.from({ length: 13 }, () => ({ title: "Missing source", description: "A consequential condition remains unknown.", evidenceToFind: null })) },
  ])("rejects invalid new persisted review data rather than treating it as legacy: %o", (invalid) => {
    const value = { decision: "stop", reason: "Legacy-looking fields cannot bypass validation.", requirements: [], ...invalid }
    expect(roundReviewSchema.safeParse(value).success).toBe(false)
    expect(() => parseRoundReview(value)).toThrow()
  })

  it("bounds accumulated evidence while preserving every round", async () => {
    mocks.generateObjectStream.mockResolvedValueOnce({
      id: "review-stream-id",
      completion: Promise.resolve({
        status: "completed",
        text: JSON.stringify({ version: 1, reason: "Enough evidence", requirements: [], gaps: [] }),
        reasoning: "",
      }),
      output: Promise.resolve({ version: 1, reason: "Enough evidence", requirements: [], gaps: [] }),
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
      sourceEvidence: [{
        title: "Eligibility terms",
        url: "https://example.com/eligibility",
        content: "Excludes existing customers. ".repeat(10_000),
        evidenceType: "page-summary",
      }],
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
    expect(context).toContain('"url":"https://example.com/eligibility"')
    expect(context).toContain('"evidenceType":"page-summary"')
    expect(context).toContain("Excludes existing customers.")
  })
})
