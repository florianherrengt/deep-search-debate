import { describe, expect, it } from "vitest"
import { ideaSchema } from "./schemas.ts"

describe("idea schema", () => {
  it("bounds generated idea fields before they enter later prompts", () => {
    expect(
      ideaSchema.safeParse({
        title: "t".repeat(161),
        description: "Useful description",
      }).success,
    ).toBe(false)
    expect(
      ideaSchema.safeParse({
        title: "Useful title",
        description: "d".repeat(2_001),
      }).success,
    ).toBe(false)
  })
})
