import { describe, expect, it } from "vitest"
import { ideaEvaluationSchema, ideaSchema } from "./schemas.ts"

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

describe("idea evaluation schema", () => {
  it("requires bounded, distinct pros and cons", () => {
    const validEvaluation = {
      pros: ["Clear user value", "Fits the existing workflow"],
      cons: ["Depends on clean data", "Requires behavior change"],
      critique: "Promising, but the first release should expose uncertainty.",
    }
    expect(ideaEvaluationSchema.safeParse(validEvaluation).success).toBe(true)
    expect(
      ideaEvaluationSchema.safeParse({
        ...validEvaluation,
        pros: ["Repeated point", "repeated point"],
      }).success,
    ).toBe(false)
    expect(
      ideaEvaluationSchema.safeParse({
        ...validEvaluation,
        cons: ["Only one point"],
      }).success,
    ).toBe(false)
  })
})
