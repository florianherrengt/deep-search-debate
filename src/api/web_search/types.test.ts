import { describe, expect, it } from "vitest"
import {
  MAX_WEB_SEARCH_RESULTS,
  MAX_WEB_SEARCH_SNIPPET_CHARS,
  MAX_WEB_SEARCH_TITLE_CHARS,
  normalizeWebSearchResults,
} from "./types.ts"

describe("web-search result normalization", () => {
  it("bounds result count and text fields before persistence", () => {
    const results = normalizeWebSearchResults(
      Array.from({ length: MAX_WEB_SEARCH_RESULTS + 5 }, (_, index) => ({
        title: `Result ${index} ${"t".repeat(MAX_WEB_SEARCH_TITLE_CHARS)}`,
        shortText: `Evidence ${index} ${"s".repeat(MAX_WEB_SEARCH_SNIPPET_CHARS)}`,
        link: `https://example.com/result/${index}`,
      })),
    )

    expect(results).toHaveLength(MAX_WEB_SEARCH_RESULTS)
    expect(results[0]?.title.length).toBe(MAX_WEB_SEARCH_TITLE_CHARS)
    expect(results[0]?.shortText.length).toBe(MAX_WEB_SEARCH_SNIPPET_CHARS)
  })

  it("keeps the first-ranked result for each canonical URL", () => {
    expect(
      normalizeWebSearchResults([
        {
          title: "First",
          shortText: "First evidence",
          link: "https://EXAMPLE.com/path/?utm_source=test#fragment",
        },
        {
          title: "Second",
          shortText: "Second evidence",
          link: "https://example.com/path",
        },
      ]),
    ).toEqual([
      {
        title: "First",
        shortText: "First evidence",
        link: "https://example.com/path",
      },
    ])
  })
})
