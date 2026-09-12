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
        "<requirements>",
        "[]",
        "</requirements>",
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
      workflowSignal: undefined,
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
      sourceEvidence: [{
        title: "Primary report",
        url: "https://example.com/original-report",
        content: "Published qualification. ".repeat(10_000),
        evidenceType: "page-summary",
      }],
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
    expect(context).toContain('"url":"https://example.com/original-report"')
    expect(context).toContain('"evidenceType":"page-summary"')
    expect(context).toContain("Published qualification.")
    expect(context).toContain("[... omitted ...]")
  })

  it("corrects a candidate using original source text, review findings, and the requirement checklist", async () => {
    mocks.generateTextStream.mockResolvedValueOnce(completedGeneration("Existing customers are excluded. [Terms](https://example.com/terms)"))
    const requirements = [{ requirement: "Determine existing customer eligibility", kind: "requirement" as const, status: "unresolved" as const, sources: [], explanation: "The candidate has not established the exclusion." }]
    const onRegistered = vi.fn()
    const generation = await answerResearchRequest({
      userId: "test-user-id", deepSearchJobId: "deep-search-job-id",
      researchRequest: "Are existing customers eligible?", requirements,
      candidateAnswer: "Everyone is eligible.", reviewReason: "Check the exclusion in the primary terms.",
      searchSummaries: [{ query: "trial terms", content: "The offer is advertised broadly." }],
      sourceEvidence: [{ url: "https://example.com/terms", title: "Terms", content: "The offer is advertised broadly.", originalPassages: "Existing customers are excluded.", evidenceType: "page-summary" }],
      onRegistered,
    })
    const call = mocks.generateTextStream.mock.calls[0]?.[0] as { prompt: string; promptName: string; onRegistered: unknown }
    expect(call.promptName).toBe("correct-research-answer")
    expect(call.onRegistered).toBe(onRegistered)
    expect(call.prompt).toContain("<candidate_answer>\nEveryone is eligible.\n</candidate_answer>")
    expect(call.prompt).toContain("Check the exclusion in the primary terms.")
    expect(call.prompt).toContain("Existing customers are excluded.")
    expect(JSON.parse(/<requirements>\n([\s\S]*?)\n<\/requirements>/.exec(call.prompt)![1])).toEqual(requirements)
    await expect(generation.answer).resolves.toBe("Existing customers are excluded. [Terms](https://example.com/terms)")
  })
})
