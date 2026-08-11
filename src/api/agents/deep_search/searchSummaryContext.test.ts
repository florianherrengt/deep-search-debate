import { describe, expect, it } from "vitest"
import { formatSearchSummaryContext } from "./searchSummaryContext.ts"

describe("search summary context", () => {
  it("preserves complete summaries when they fit", () => {
    expect(
      formatSearchSummaryContext(
        [{ query: "market changes", content: "Demand increased." }],
        1_000,
      ),
    ).toBe(
      [
        "<search_summary>",
        "Search query: market changes",
        "Summary:",
        "Demand increased.",
        "</search_summary>",
      ].join("\n"),
    )
  })

  it("keeps every oversized summary ordered, bounded, and unmodified", () => {
    const summaries = [
      {
        round: 0,
        query: `first-query-start-${"q".repeat(300)}-first-query-end`,
        content: `first-content-start-${"a".repeat(1_000)}-first-content-end`,
      },
      {
        round: 1,
        query: `second-query-start-${"q".repeat(300)}-second-query-end`,
        content: `second-content-start-${"b".repeat(1_000)}-second-content-end`,
      },
    ]
    const original = structuredClone(summaries)

    const context = formatSearchSummaryContext(summaries, 600)

    expect(context.length).toBeLessThanOrEqual(600)
    expect(context).toContain('<search_summary round="1">')
    expect(context).toContain('<search_summary round="2">')
    expect(context.indexOf('round="1"')).toBeLessThan(
      context.indexOf('round="2"'),
    )
    expect(context).toContain("first-query-start")
    expect(context).toContain("first-query-end")
    expect(context).toContain("first-content-start")
    expect(context).toContain("first-content-end")
    expect(context).toContain("second-query-start")
    expect(context).toContain("second-query-end")
    expect(context).toContain("second-content-start")
    expect(context).toContain("second-content-end")
    expect(context.match(/\[\.\.\. omitted \.\.\.\]/g)?.length).toBe(4)
    expect(summaries).toEqual(original)
  })

  it("gives equally long summaries equal serialized space", () => {
    const context = formatSearchSummaryContext(
      [
        { query: "first", content: "a".repeat(2_000) },
        { query: "other", content: "b".repeat(2_000) },
      ],
      800,
    )
    const blocks = context.split("\n\n")

    expect(blocks).toHaveLength(2)
    expect(blocks[0]?.length).toBe(blocks[1]?.length)
  })

  it("redistributes unused space from short summaries", () => {
    const context = formatSearchSummaryContext(
      [
        { query: "short", content: "small" },
        { query: "large", content: "x".repeat(2_000) },
      ],
      800,
    )

    expect(context.length).toBe(800)
    expect(context).toContain("small")
    expect(context).toContain("[... omitted ...]")
  })

  it("rejects a budget that cannot preserve valid wrappers", () => {
    expect(() =>
      formatSearchSummaryContext(
        [{ query: "query", content: "content".repeat(100) }],
        20,
      ),
    ).toThrow("Summary context budget is too small")
  })
})
