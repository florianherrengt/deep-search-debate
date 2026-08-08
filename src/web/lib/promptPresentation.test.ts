import { describe, expect, it } from "vitest"
import {
  getPromptExcerpt,
  PROMPT_EXCERPT_MAX_LENGTH,
} from "./promptPresentation.ts"

describe("getPromptExcerpt", () => {
  it("normalizes whitespace without truncating short prompts", () => {
    expect(getPromptExcerpt("  Research\n\nLondon   renters  ")).toBe(
      "Research London renters",
    )
  })

  it("caps long prompts and adds an ellipsis", () => {
    const excerpt = getPromptExcerpt("a".repeat(300))
    expect(excerpt).toHaveLength(PROMPT_EXCERPT_MAX_LENGTH)
    expect(excerpt.endsWith("…")).toBe(true)
  })

})
