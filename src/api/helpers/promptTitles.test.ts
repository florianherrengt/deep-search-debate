import { describe, expect, it } from "vitest"
import {
  createPromptIdentity,
  slugifyPromptTitle,
} from "./promptTitles.ts"

describe("prompt titles", () => {
  it("creates readable slugs from generated titles", () => {
    expect(slugifyPromptTitle("London Renters' Energy Options")).toBe(
      "london-renters-energy-options",
    )
  })

  it("preserves letters from non-English titles", () => {
    expect(slugifyPromptTitle("Énergie à Paris")).toBe("energie-a-paris")
    expect(slugifyPromptTitle("東京の住宅政策")).toBe("東京の住宅政策")
  })

  it("numbers repeated titles and skips occupied numbers", () => {
    expect(
      createPromptIdentity("London Energy Options", [
        "london-energy-options",
        "london-energy-options-2",
      ]),
    ).toEqual({
      title: "London Energy Options 3",
      slug: "london-energy-options-3",
    })
  })
})
