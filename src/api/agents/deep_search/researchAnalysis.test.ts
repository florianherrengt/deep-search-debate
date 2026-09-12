import { beforeEach, describe, expect, it, vi } from "vitest"
import type { ZodType } from "zod"

import { loadPrompt, PromptName } from "../../llms/prompts.ts"

const mocks = vi.hoisted(() => ({ generateObjectStream: vi.fn() }))

vi.mock("../../llms/generateText.ts", () => ({
  generateObjectStream: mocks.generateObjectStream,
}))

import { analyzeResearchAnswer } from "./researchAnalysis.ts"
import { config } from "../../config.ts"
import {
  parseResearchAnalysisText,
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
  requirements: [{ requirement: "Identify regional changes", kind: "requirement" as const, status: "unresolved" as const, sources: [], explanation: "Regional data remains incomplete." }],
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
      requirements: analysis.requirements,
      searchSummaries: [
        {
          round: 0,
          query: "market size changes",
          content:
            "The market expanded during 2025. https://example.com/market",
        },
      ],
    })

    expect(mocks.generateObjectStream).toHaveBeenCalledWith(expect.objectContaining({
      userId: "test-user-id",
      owner: { deepSearchJobId: "deep-search-job-id" },
      prompt: [
        "<research_request>",
        "What changed in the market?",
        "</research_request>",
        "<requirements>",
        JSON.stringify(analysis.requirements),
        "</requirements>",
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
      reasoning: "disabled",
      workflowSignal: undefined,
    }))
    const { schema } = mocks.generateObjectStream.mock.calls[0]?.[0] as { schema: ZodType<typeof analysis> }
    expect(schema.parse(analysis)).toEqual(analysis)
    const { requirements: _requirements, ...legacyAnalysis } = analysis
    expect(schema.safeParse(legacyAnalysis).success).toBe(false)
    expect(parseResearchAnalysisText(JSON.stringify(legacyAnalysis))).toEqual(legacyAnalysis)
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

  it("retains direct attribution and qualifications omitted from query summaries within one budget", async () => {
    mocks.generateObjectStream.mockResolvedValueOnce({
      id: "analysis-generation-id",
      output: Promise.resolve(analysis),
      completion: Promise.resolve({
        status: "completed",
        text: JSON.stringify(analysis),
        reasoning: "",
      }),
    })
    await analyzeResearchAnswer({
      userId: "test-user-id",
      deepSearchJobId: "deep-search-job-id",
      researchRequest: "What changed?",
      finalAnswer: "Growth was reported.",
      searchSummaries: [{ round: 0, query: "growth", content: "Growth reported. ".repeat(10_000) }],
      sourceEvidence: [{
        title: "Regional report",
        url: "https://example.com/regional-report",
        evidenceType: "page-summary",
        content: "Only the surveyed region is covered. ".repeat(10_000),
      }],
    })

    const { prompt } = mocks.generateObjectStream.mock.calls[0]?.[0] as { prompt: string }
    const context = /<search_summaries>\n([\s\S]*)\n<\/search_summaries>/.exec(prompt)?.[1]
    expect(context?.length).toBeLessThanOrEqual(config.deepSearch.maxSummaryContextChars)
    expect(context).toContain("Growth reported.")
    expect(context).toContain("https://example.com/regional-report")
    expect(context).toContain('"evidenceType":"page-summary"')
    expect(context).toContain("Only the surveyed region is covered.")
  })
})
