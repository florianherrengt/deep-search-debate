import { beforeEach, describe, expect, it, vi } from "vitest"

const mocks = vi.hoisted(() => ({ generateTextStream: vi.fn() }))

vi.mock("../../llms/generateText.ts", () => ({
  generateTextStream: mocks.generateTextStream,
}))

import { answerResearchRequest } from "./finalAnswer.ts"

describe("final research answer", () => {
  beforeEach(() => vi.clearAllMocks())

  it("registers one answer stream containing every top-level summary", async () => {
    mocks.generateTextStream.mockResolvedValueOnce({
      id: "final-answer-stream-id",
    })

    const streamId = await answerResearchRequest({
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
    })
    expect(streamId).toBe("final-answer-stream-id")
  })

  it("propagates stream registration failures", async () => {
    mocks.generateTextStream.mockRejectedValueOnce(
      new Error("Stream registration failed"),
    )

    await expect(
      answerResearchRequest({
        researchRequest: "Research this",
        searchSummaries: [],
      }),
    ).rejects.toThrow("Stream registration failed")
  })
})
