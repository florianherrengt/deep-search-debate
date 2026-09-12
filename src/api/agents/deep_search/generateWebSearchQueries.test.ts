import { beforeEach, describe, expect, it, vi } from "vitest"
import type { ZodType } from "zod"

const mocks = vi.hoisted(() => ({ generateObjectStream: vi.fn() }))
vi.mock("../../llms/generateText.ts", () => ({ generateObjectStream: mocks.generateObjectStream }))

import { generateWebSearchQueries } from "./queries.ts"
import { parseResearchPlan, type ResearchRequirements } from "./schemas.ts"
import { config } from "../../config.ts"

type ResearchPlan = ReturnType<typeof parseResearchPlan>
const requirements: ResearchRequirements = [{
  requirement: "Establish trial eligibility",
  kind: "requirement",
  status: "unresolved",
  sources: [],
  explanation: "The eligibility terms still need checking.",
}]

function plan(queries: string[]): ResearchPlan {
  return { version: 1, requirements, queries }
}

function completedGeneration(output: ResearchPlan) {
  return {
    id: "stream-id",
    output: Promise.resolve(output),
    completion: Promise.resolve({ status: "completed" as const, text: JSON.stringify(output), reasoning: "" }),
  }
}

function planningCall() {
  const call = mocks.generateObjectStream.mock.calls[0]?.[0] as {
    prompt: string
    promptName: string
    schema: ZodType<ResearchPlan>
    onRegistered?: unknown
    onCompleted?: (completed: { id: string; output: ResearchPlan }, transaction: unknown) => void
  } | undefined
  if (!call) throw new Error("Planning generation did not start")
  return call
}

describe("generateWebSearchQueries", () => {
  beforeEach(() => vi.clearAllMocks())

  it("returns queries from a versioned plan and commits the same ordered queries", async () => {
    const output = plan(["trial eligibility terms", "trial customer exclusions"])
    mocks.generateObjectStream.mockResolvedValueOnce(completedGeneration(output))
    const onRegistered = vi.fn()
    const onCompleted = vi.fn()
    const generation = await generateWebSearchQueries({
      userId: "test-user-id", deepSearchJobId: "deep-search-job-id",
      researchRequest: "Who is eligible for the trial?", maxSearches: 2,
      onRegistered, onCompleted,
    })
    const call = planningCall()
    expect(call.promptName).toBe("generate-websearch-queries")
    expect(call.schema.parse(output)).toEqual(output)
    expect(call.onRegistered).toBe(onRegistered)
    const transaction = {}
    call.onCompleted?.({ id: generation.streamId, output }, transaction)
    expect(onCompleted).toHaveBeenCalledWith({ id: "stream-id", output: output.queries }, transaction)
    await expect(generation.queries).resolves.toEqual(output.queries)
  })

  it("rejects malformed, repeated, or incorrectly sized new query plans instead of repairing them", async () => {
    mocks.generateObjectStream.mockResolvedValueOnce(completedGeneration(plan(["trial age", "trial region"])))
    await generateWebSearchQueries({
      userId: "test-user-id", deepSearchJobId: "deep-search-job-id",
      researchRequest: "Who is eligible?", maxSearches: 2, previousQueries: ["trial terms"],
    })
    const { schema } = planningCall()
    expect(schema.safeParse(["trial age", "trial region"]).success).toBe(false)
    expect(schema.safeParse({ ...plan(["trial age", "trial region"]), version: 2 }).success).toBe(false)
    for (const queries of [[], ["trial age"], ["trial age", "trial region", "trial duration"], ["trial age", "TRIAL AGE"], ["TRIAL TERMS", "trial age"], ["  ", "trial age"], ["q".repeat(501), "trial age"]]) {
      expect(schema.safeParse(plan(queries)).success).toBe(false)
    }
    expect(schema.safeParse({ ...plan(["trial age", "trial region"]), requirements: [{ ...requirements[0], status: "complete" }] }).success).toBe(false)
  })

  it.each([
    { format: "persisted generateArrayStream object", text: '{"elements":["original query","second query"]}' },
    { format: "bare array", text: '["original query","second query"]' },
  ])("reads a completed legacy $format without inventing requirements", ({ text }) => {
    expect(parseResearchPlan(text)).toEqual({ version: undefined, requirements: [], queries: ["original query", "second query"] })
  })

  it("preserves empty legacy plans and rejects malformed stored elements", () => {
    expect(parseResearchPlan("[]")).toEqual({ version: undefined, requirements: [], queries: [] })
    expect(parseResearchPlan('{"elements":[]}')).toEqual({ version: undefined, requirements: [], queries: [] })
    expect(() => parseResearchPlan('["query",3]')).toThrow()
    expect(() => parseResearchPlan('{"elements":["query",3]}')).toThrow()
    expect(() => parseResearchPlan('{"elements":"query"}')).toThrow()
  })

  it("propagates structured generation errors", async () => {
    mocks.generateObjectStream.mockResolvedValueOnce({
      id: "stream-id", output: Promise.reject(new Error("API error")),
      completion: Promise.resolve({ status: "failed", text: "", reasoning: "", error: "API error", failureKind: "stream" }),
    })
    const generation = await generateWebSearchQueries({ userId: "test-user-id", deepSearchJobId: "deep-search-job-id", researchRequest: "Research this", maxSearches: 1 })
    await expect(generation.queries).rejects.toThrow("API error")
  })

  it("passes the requirement gaps, earlier queries, and critique into the next plan", async () => {
    mocks.generateObjectStream.mockResolvedValueOnce(completedGeneration(plan(["trial eligibility exclusions"])))
    await generateWebSearchQueries({
      userId: "test-user-id", deepSearchJobId: "deep-search-job-id",
      researchRequest: "Who is eligible?", maxSearches: 1, round: 1,
      previousQueries: ["trial terms"], requirements,
      previousSearchSummaries: [{ query: "trial terms", content: "The offer is advertised broadly." }],
      previousCandidateAnswer: "The trial appears available to everyone.",
      previousReviewReason: "Existing customer exclusions remain unverified.",
    })
    const { prompt } = planningCall()
    expect(JSON.parse(/<requirements>\n([\s\S]*?)\n<\/requirements>/.exec(prompt)![1])).toEqual(requirements)
    expect(JSON.parse(/<previous_queries>\n([\s\S]*?)\n<\/previous_queries>/.exec(prompt)![1])).toEqual(["trial terms"])
    expect(prompt).toContain("The offer is advertised broadly.")
    expect(prompt).toContain("The trial appears available to everyone.")
    expect(prompt).toContain("Existing customer exclusions remain unverified.")
  })

  it("bounds all prior evidence while retaining source provenance", async () => {
    mocks.generateObjectStream.mockResolvedValueOnce(completedGeneration(plan(["trial eligibility terms"])))
    await generateWebSearchQueries({
      userId: "test-user-id", deepSearchJobId: "deep-search-job-id",
      researchRequest: "Who is eligible?", maxSearches: 1,
      previousSearchSummaries: [{ query: "first evidence", content: "a".repeat(100_000) }, { query: "second evidence", content: "b".repeat(100_000) }],
      sourceEvidence: [{ title: "Terms search result", url: "https://example.com/terms", content: "The linked terms need verification. ".repeat(10_000), evidenceType: "search-snippet" }],
    })
    const context = /<previous_search_summaries>\n([\s\S]*)\n<\/previous_search_summaries>/.exec(planningCall().prompt)![1]
    expect(context.length).toBeLessThanOrEqual(config.deepSearch.maxSummaryContextChars)
    expect(context).toContain("first evidence")
    expect(context).toContain("second evidence")
    expect(context).toContain('"url":"https://example.com/terms"')
    expect(context).toContain('"evidenceType":"search-snippet"')
    expect(context).toContain("The linked terms need verification.")
  })

  it("includes direct evidence even when no query summary is available", async () => {
    mocks.generateObjectStream.mockResolvedValueOnce(completedGeneration(plan(["trial eligibility terms"])))
    await generateWebSearchQueries({
      userId: "test-user-id", deepSearchJobId: "deep-search-job-id", researchRequest: "Who is eligible?", maxSearches: 1,
      sourceEvidence: [{ title: "Trial terms", url: "https://example.com/terms", content: "Existing subscribers are excluded.", evidenceType: "page-summary" }],
    })
    expect(planningCall().prompt).toContain("Existing subscribers are excluded.")
    expect(planningCall().prompt).toContain('"url":"https://example.com/terms"')
  })
})
