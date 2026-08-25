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

  it("probes candidates in order and uses the first numeric gap", () => {
    const probes: string[] = []
    const occupied = new Set([
      "london-energy-options",
      "london-energy-options-3",
    ])

    expect(
      createPromptIdentity("London Energy Options", (slug) => {
        probes.push(slug)
        return occupied.has(slug)
      }),
    ).toEqual({
      title: "London Energy Options 2",
      slug: "london-energy-options-2",
    })
    expect(probes).toEqual([
      "london-energy-options",
      "london-energy-options-2",
    ])
  })

  it("increments past consecutive occupied suffixes", () => {
    const occupied = new Set([
      "london-energy-options",
      "london-energy-options-2",
    ])

    expect(
      createPromptIdentity("London Energy Options", (slug) =>
        occupied.has(slug),
      ),
    ).toEqual({
      title: "London Energy Options 3",
      slug: "london-energy-options-3",
    })
  })

  it("normalizes supplied titles to the persisted display limit", () => {
    const identity = createPromptIdentity("A".repeat(86), () => false)

    expect(identity.title).toBe("A".repeat(80))
    expect(identity.slug).toBe("a".repeat(80))
  })
})
