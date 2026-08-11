import { beforeEach, describe, expect, it, vi } from "vitest"

const mocks = vi.hoisted(() => ({ generateTextStream: vi.fn() }))

vi.mock("../../llms/generateText.ts", () => ({
  generateTextStream: mocks.generateTextStream,
}))

import { answerResearchRequest } from "./finalAnswer.ts"
import { config } from "../../config.ts"

function completedGeneration(text = "Completed answer") {
  return {
    id: "final-answer-stream-id",
    completion: Promise.resolve({
      status: "completed" as const,
      text,
      reasoning: "",
    }),
  }
}

describe("final research answer", () => {
  beforeEach(() => vi.clearAllMocks())

  it("registers one answer stream containing every top-level summary", async () => {
    mocks.generateTextStream.mockResolvedValueOnce(completedGeneration())

    const generation = await answerResearchRequest({
      userId: "test-user-id",
      deepSearchJobId: "deep-search-job-id",
      researchRequest: "What changed in the market?",
      searchSummaries: [
        {
          query: "market size changes",
          content: "The market expanded during 2025.",
        },
        {
          query: "market risks",
          content: "Demand remains sensitive to interest rates.",
        },
      ],
    })

    expect(mocks.generateTextStream).toHaveBeenCalledWith({
      userId: "test-user-id",
      owner: { deepSearchJobId: "deep-search-job-id" },
      prompt: [
        "user_query: What changed in the market?",
        "search_summaries:",
        "<search_summaries>",
        "<search_summary>",
        "Search query: market size changes",
        "Summary:",
        "The market expanded during 2025.",
        "</search_summary>",
        "",
        "<search_summary>",
        "Search query: market risks",
        "Summary:",
        "Demand remains sensitive to interest rates.",
        "</search_summary>",
        "</search_summaries>",
      ].join("\n"),
      promptName: "answer-research-request",
      reasoning: "disabled",
      maxOutputTokens: 4_096,
    })
    expect(generation.streamId).toBe("final-answer-stream-id")
    await expect(generation.answer).resolves.toBe("Completed answer")
  })

  it("propagates stream registration failures", async () => {
    mocks.generateTextStream.mockRejectedValueOnce(
      new Error("Stream registration failed"),
    )

    await expect(
      answerResearchRequest({
        userId: "test-user-id",
        deepSearchJobId: "deep-search-job-id",
        researchRequest: "Research this",
        searchSummaries: [],
      }),
    ).rejects.toThrow("Stream registration failed")
  })

  it("bounds accumulated evidence while retaining every summary", async () => {
    mocks.generateTextStream.mockResolvedValueOnce(completedGeneration())

    await answerResearchRequest({
      userId: "test-user-id",
      deepSearchJobId: "deep-search-job-id",
      researchRequest: "Research this",
      searchSummaries: [
        { query: "first evidence", content: "a".repeat(100_000) },
        { query: "second evidence", content: "b".repeat(100_000) },
      ],
    })

    const prompt = (mocks.generateTextStream.mock.calls[0]?.[0] as {
      prompt: string
    }).prompt
    const context = /<search_summaries>\n([\s\S]*)\n<\/search_summaries>/.exec(
      prompt,
    )?.[1]
    expect(context).toBeDefined()
    expect(context?.length).toBeLessThanOrEqual(
      config.deepSearch.maxSummaryContextChars,
    )
    expect(context).toContain("first evidence")
    expect(context).toContain("second evidence")
    expect(context).toContain("[... omitted ...]")
  })
})
