import { beforeEach, describe, expect, it, vi } from "vitest"
import type { ZodType } from "zod"

const mocks = vi.hoisted(() => ({
  generateArrayStream: vi.fn(),
}))

vi.mock("../../llms/generateText.ts", () => ({
  generateArrayStream: mocks.generateArrayStream,
}))

import { generateWebSearchQueries } from "./queries.ts"
import { config } from "../../config.ts"

function completedGeneration(output: Promise<string[]>) {
  return {
    id: "stream-id",
    output,
    completion: Promise.resolve({
      status: "completed" as const,
      text: "[]",
      reasoning: "",
    }),
  }
}

describe("generateWebSearchQueries", () => {
  beforeEach(() => vi.clearAllMocks())

  it("generates deduplicated queries from structured output", async () => {
    mocks.generateArrayStream.mockResolvedValueOnce(
      completedGeneration(
        Promise.resolve([
          "quantum computing basics",
          "quantum computing applications",
          "quantum computing basics",
        ]),
      ),
    )

    const result = await generateWebSearchQueries({
      userId: "test-user-id",
      deepSearchJobId: "deep-search-job-id",
      researchRequest: "quantum computing",
      maxSearches: 2,
    })

    const call = mocks.generateArrayStream.mock.calls[0]?.[0] as
      | {
          prompt: string
          promptName: string
          element: ZodType<string>
        }
      | undefined
    expect(call).toBeDefined()
    if (!call) throw new Error("generateArrayStream was not called")
    expect(call).toMatchObject({
      promptName: "generate-websearch-queries",
    })
    expect(call.prompt).toContain("quantum computing")
    expect(call.prompt).toContain("Generate exactly 2 search queries")
    expect(call.element.parse(" valid query ")).toBe("valid query")
    expect(() => call.element.parse("  ")).toThrow()
    expect(() => call.element.parse("q".repeat(501))).toThrow()
    expect(result.streamId).toBe("stream-id")
    await expect(result.queries).resolves.toEqual([
      "quantum computing basics",
      "quantum computing applications",
    ])
  })

  it("propagates structured output errors", async () => {
    mocks.generateArrayStream.mockResolvedValueOnce(
      completedGeneration(Promise.reject(new Error("API error"))),
    )

    const generation = await generateWebSearchQueries({
      userId: "test-user-id",
      deepSearchJobId: "deep-search-job-id",
      researchRequest: "test",
      maxSearches: 3,
    })
    await expect(generation.queries).rejects.toThrow("API error")
  })

  it("excludes queries already executed in earlier rounds", async () => {
    mocks.generateArrayStream.mockResolvedValueOnce(
      completedGeneration(
        Promise.resolve([
          "FIRST QUERY",
          "new evidence query",
          "New Evidence Query",
        ]),
      ),
    )

    const generation = await generateWebSearchQueries({
      userId: "test-user-id",
      deepSearchJobId: "deep-search-job-id",
      researchRequest: "Research this",
      maxSearches: 3,
      round: 1,
      previousQueries: ["first query"],
      previousSearchSummaries: [
        { query: "first query", content: "Existing findings" },
      ],
      previousCandidateAnswer: "The current answer does not cover regulation.",
      previousReviewReason:
        "The next round should find an authoritative regulatory source.",
    })

    await expect(generation.queries).resolves.toEqual(["new evidence query"])
    const call = mocks.generateArrayStream.mock.calls[0]?.[0] as
      | { prompt: string }
      | undefined
    expect(call).toBeDefined()
    if (!call) throw new Error("generateArrayStream was not called")
    expect(call.prompt).not.toContain("<already_executed_queries>")
    expect(call.prompt).toContain("<previous_search_summaries>")
    expect(call.prompt).toContain("<search_summary>")
    expect(call.prompt).toContain("first query")
    expect(call.prompt).toContain("Existing findings")
    expect(call.prompt).toContain("<previous_candidate_answer>")
    expect(call.prompt).toContain(
      "The current answer does not cover regulation.",
    )
    expect(call.prompt).toContain("<previous_review_reason>")
    expect(call.prompt).toContain(
      "The next round should find an authoritative regulatory source.",
    )
    expect(call.prompt).toContain("Generate exactly 3 new search queries")
  })

  it("forwards registration and commits normalized query output", async () => {
    mocks.generateArrayStream.mockResolvedValueOnce(
      completedGeneration(Promise.resolve(["new query"])),
    )
    const onRegistered = vi.fn()
    const onCompleted = vi.fn()

    await generateWebSearchQueries({
      userId: "test-user-id",
      deepSearchJobId: "deep-search-job-id",
      researchRequest: "Research this",
      maxSearches: 2,
      previousQueries: ["existing query"],
      onRegistered,
      onCompleted,
    })

    const call = mocks.generateArrayStream.mock.calls[0]?.[0] as {
      onRegistered: typeof onRegistered
      onCompleted: (
        completed: { id: string; output: string[] },
        transaction: unknown,
      ) => void
    }
    expect(call.onRegistered).toBe(onRegistered)
    const transaction = {}
    call.onCompleted(
      {
        id: "stream-id",
        output: ["EXISTING QUERY", "new query", "New Query", "second query"],
      },
      transaction,
    )
    expect(onCompleted).toHaveBeenCalledWith(
      { id: "stream-id", output: ["new query", "second query"] },
      transaction,
    )
  })

  it("bounds prior evidence without repeating the executed-query list", async () => {
    mocks.generateArrayStream.mockResolvedValueOnce(
      completedGeneration(Promise.resolve(["new query"])),
    )

    await generateWebSearchQueries({
      userId: "test-user-id",
      deepSearchJobId: "deep-search-job-id",
      researchRequest: "Research this",
      maxSearches: 1,
      round: 2,
      previousQueries: ["first evidence", "second evidence"],
      previousSearchSummaries: [
        { query: "first evidence", content: "a".repeat(100_000) },
        { query: "second evidence", content: "b".repeat(100_000) },
      ],
    })

    const prompt = (mocks.generateArrayStream.mock.calls[0]?.[0] as {
      prompt: string
    }).prompt
    const context =
      /<previous_search_summaries>\n([\s\S]*)\n<\/previous_search_summaries>/.exec(
        prompt,
      )?.[1]
    expect(context).toBeDefined()
    expect(context?.length).toBeLessThanOrEqual(
      config.deepSearch.maxSummaryContextChars,
    )
    expect(context).toContain("first evidence")
    expect(context).toContain("second evidence")
    expect(prompt).not.toContain("<already_executed_queries>")
  })

})
