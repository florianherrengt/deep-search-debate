import { describe, expect, it } from "vitest"
import { formatSearchSummaryContext } from "./searchSummaryContext.ts"
import { selectRelevantPassages } from "../../helpers/boundedText.ts"

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

  it("shares one budget across every round and direct source without truncating source metadata", () => {
    const summaries = [
      { round: 0, query: "published terms", content: "first evidence ".repeat(500) },
      { round: 1, query: "eligibility exclusions", content: "second evidence ".repeat(500) },
    ]
    const sources = [
      {
        title: "Original terms",
        url: `https://example.com/terms/${"version-".repeat(30)}2026`,
        evidenceType: "page-summary" as const,
        content: `Age requirement: 18. ${"source text ".repeat(500)}Excludes trial accounts.`,
      },
      {
        title: "Search lead",
        url: "https://other.example.com/eligibility",
        evidenceType: "search-snippet" as const,
        content: "Availability unverified.",
      },
    ]
    const original = structuredClone({ summaries, sources })

    const context = formatSearchSummaryContext(summaries, 1_500, sources)

    expect(context.length).toBeLessThanOrEqual(1_500)
    expect(context).toContain('<search_summary round="1">')
    expect(context).toContain('<search_summary round="2">')
    expect(context).toContain("first evidence")
    expect(context).toContain("second evidence")
    expect(context).toContain(sources[0].url)
    expect(context).toContain(sources[1].url)
    expect(context).toContain('"evidenceType":"page-summary"')
    expect(context).toContain('"evidenceType":"search-snippet"')
    expect(context).toContain("Age requirement: 18.")
    expect(context).toContain("Excludes trial accounts.")
    expect(context).toContain("Availability unverified.")
    expect({ summaries, sources }).toEqual(original)
  })

  it("fails explicitly when source metadata cannot fit instead of corrupting its URL", () => {
    expect(() => formatSearchSummaryContext([], 100, [{
      title: "Terms",
      url: `https://example.com/${"qualification".repeat(30)}`,
      content: "Known qualification.",
      evidenceType: "page-summary",
    }])).toThrow("Summary context budget is too small for every summary and source metadata")
  })

  it("bounds a failed linked page's title while keeping its unavailable status and exact URL", () => {
    const context = formatSearchSummaryContext([], 800, [{
      title: "Very long linked page label ".repeat(1_000),
      url: "https://example.com/linked-terms",
      content: "Page extraction failed; no page evidence is available.",
      evidenceType: "unavailable",
    }])

    expect(context.length).toBeLessThanOrEqual(800)
    expect(context).toContain('"url":"https://example.com/linked-terms"')
    expect(context).toContain('"evidenceType":"unavailable"')
    expect(context).not.toContain('"evidenceType":"search-snippet"')
    expect(context).toContain("Page extraction failed; no page evidence is available.")
  })

  it("retains a relevant original qualification lost by both summaries within the shared budget", () => {
    const qualification = "Trial eligibility: existing customers are excluded; the price is £14."
    const originalPassages = `${"General company background. ".repeat(200)}\n\n${qualification}\n\n${"General company background. ".repeat(200)}`
    const context = formatSearchSummaryContext(
      [{ query: "trial terms", content: "The offer is advertised broadly." }],
      1_000,
      [{ title: "Trial terms", url: "https://example.com/terms", content: "The offer is advertised broadly.", originalPassages, evidenceType: "page-summary" }],
      "Trial eligibility for existing customers",
    )
    expect(context.length).toBeLessThanOrEqual(1_000)
    expect(context).toContain('"url":"https://example.com/terms"')
    expect(context).toContain("Original source passages")
    expect(context).toContain(qualification)
  })
  it("uses a full page summary to retain a source caveat absent from the request", () => {
    const qualification = "Sealed exports require unchanged media; modifying them can produce stale results."
    const originalPassages = `${"Records access background. ".repeat(200)}\n${qualification}\n${"Records access background. ".repeat(200)}`
    const sources = [{
      title: "Export documentation", url: "https://example.com/exports", evidenceType: "page-summary" as const,
      content: `${"Reference overview. ".repeat(100)}${qualification}${"Reference overview. ".repeat(100)}`,
      originalPassages,
    }, {
      title: "Access documentation", url: "https://example.com/access", evidenceType: "page-summary" as const,
      content: "Records access information. ".repeat(200), originalPassages: "Published access details. ".repeat(200),
    }]
    const before = structuredClone(sources)

    const context = formatSearchSummaryContext([], 5_000, sources, "Explain records access")
    const firstSource = context.split("</source_evidence>")[0]
    const [summary, passages] = firstSource.split("Original source passages (verbatim excerpts; omissions marked):\n")

    expect(context.length).toBeLessThanOrEqual(5_000)
    expect(summary).not.toContain(qualification)
    expect(passages).toContain(qualification)
    for (const passage of passages.trim().split("\n[... omitted ...]\n")) {
      expect(originalPassages).toContain(passage)
    }
    for (const source of sources) {
      expect(context).toContain(source.url)
      expect(context).toContain(source.title)
    }
    expect(context.indexOf(sources[0].url)).toBeLessThan(context.indexOf(sources[1].url))
    expect(sources).toEqual(before)
  })
})

describe("query-relevant original passages", () => {
  it("keeps middle evidence as verbatim source text rather than substituting a generated summary", () => {
    const qualification = "Trial eligibility: existing customers are excluded; the price is £14."
    const source = `${"General company background. ".repeat(250)}\n\n${qualification}\n\n${"Corporate background and history. ".repeat(250)}`
    const passages = selectRelevantPassages(source, "Trial eligibility existing customers price", 700)
    expect(passages.length).toBeLessThanOrEqual(700)
    expect(passages).toContain(qualification)
    for (const passage of passages.split("\n[... omitted ...]\n")) {
      expect(source).toContain(passage)
    }
    expect(passages).not.toBe(source.slice(0, 700))
  })

  it("preserves complete short source data and respects a zero budget", () => {
    const source = '{"monthlyPrice":14,"existingCustomersEligible":false}'
    expect(selectRelevantPassages(source, "customer eligibility", 100)).toBe(source)
    expect(selectRelevantPassages(source, "customer eligibility", 0)).toBe("")
  })
})
