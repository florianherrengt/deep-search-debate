import { beforeEach, describe, expect, it, vi } from "vitest"

import { loadPrompt, PromptName } from "../../llms/prompts.ts"

const mocks = vi.hoisted(() => ({ generateObjectStream: vi.fn() }))

vi.mock("../../llms/generateText.ts", () => ({
  generateObjectStream: mocks.generateObjectStream,
}))

import { analyzeResearchAnswer } from "./researchAnalysis.ts"
import {
  parseResearchAnalysisText,
  researchAnalysisSchema,
} from "./schemas.ts"

const analysis = {
  facts: [
    {
      title: "The market expanded",
      description: "Two sources report market growth during 2025.",
      sources: ["https://example.com/market"],
    },
  ],
  disagreements: [],
  gaps: [
    {
      title: "Regional data is incomplete",
      description: "The supplied evidence does not cover every region.",
    },
  ],
  assumptions: [],
}

describe("research answer analysis", () => {
  beforeEach(() => vi.clearAllMocks())

  it("states the structured collection bounds explicitly in the prompt", async () => {
    const prompt = await loadPrompt(PromptName.AnalyzeResearchAnswer)

    expect(prompt).toContain("no more than 12 items in each collection")
    expect(prompt).toContain("no more than 12 source URLs")
  })

  it("starts a separate schema-constrained generation from the accepted answer", async () => {
    mocks.generateObjectStream.mockResolvedValueOnce({
      id: "analysis-generation-id",
      output: Promise.resolve(analysis),
      completion: Promise.resolve({
        status: "completed",
        text: JSON.stringify(analysis),
        reasoning: "",
      }),
    })

    const generation = await analyzeResearchAnswer({
      userId: "test-user-id",
      deepSearchJobId: "deep-search-job-id",
      researchRequest: "What changed in the market?",
      finalAnswer: "The market expanded during 2025.",
      searchSummaries: [
        {
          round: 0,
          query: "market size changes",
          content:
            "The market expanded during 2025. https://example.com/market",
        },
      ],
    })

    expect(mocks.generateObjectStream).toHaveBeenCalledWith({
      userId: "test-user-id",
      owner: { deepSearchJobId: "deep-search-job-id" },
      prompt: [
        "<research_request>",
        "What changed in the market?",
        "</research_request>",
        "<final_answer>",
        "The market expanded during 2025.",
        "</final_answer>",
        "<search_summaries>",
        '<search_summary round="1">',
        "Search query: market size changes",
        "Summary:",
        "The market expanded during 2025. https://example.com/market",
        "</search_summary>",
        "</search_summaries>",
      ].join("\n"),
      promptName: "analyze-research-answer",
      schema: researchAnalysisSchema,
      reasoning: "disabled",
      maxOutputTokens: 4_096,
      workflowSignal: undefined,
    })
    expect(generation.generationId).toBe("analysis-generation-id")
    await expect(generation.analysis).resolves.toEqual(analysis)
  })

  it("parses the durable structured payload and rejects malformed output", () => {
    expect(parseResearchAnalysisText(JSON.stringify(analysis))).toEqual(
      analysis,
    )
    expect(() =>
      parseResearchAnalysisText('{"facts":"not-an-array"}'),
    ).toThrow()
    expect(() =>
      parseResearchAnalysisText(
        JSON.stringify({
          ...analysis,
          facts: [{ ...analysis.facts[0], sources: ["javascript:alert(1)"] }],
        }),
      ),
    ).toThrow()
  })
})
