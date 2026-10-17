import { describe, expect, it } from "vitest"
import { ideaEvaluationSchema, ideaSchema } from "./schemas.ts"

describe("idea schema", () => {
  it("accepts useful descriptions through 5,000 characters without truncating them", () => {
    const description = "d".repeat(5_000)
    expect(
      ideaSchema.parse({
        title: " Useful title ",
        description: ` ${description} `,
      }),
    ).toEqual({ title: "Useful title", description })
  })

  it("rejects descriptions above the cap and keeps title and empty-value bounds", () => {
    expect(
      ideaSchema.safeParse({
        title: "t".repeat(161),
        description: "Useful description",
      }).success,
    ).toBe(false)
    expect(
      ideaSchema.safeParse({
        title: "Useful title",
        description: "d".repeat(5_001),
      }).success,
    ).toBe(false)
    expect(
      ideaSchema.safeParse({
        title: "Useful title",
        description: "  \n  ",
      }).success,
    ).toBe(false)
  })

  it("advertises the description cap to structured-output providers", () => {
    const jsonSchema = ideaSchema.toJSONSchema({ target: "draft-7" })
    expect(jsonSchema).toHaveProperty("properties.description.maxLength", 5_000)
    expect(jsonSchema).toHaveProperty("properties.title.maxLength", 160)
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

    expect(
      ideaEvaluationSchema.safeParse({
        ...validEvaluation,
        pros: ["p".repeat(304), "Still concise enough for a detailed evaluation"],
      }).success,
    ).toBe(true)
    expect(
      ideaEvaluationSchema.safeParse({
        ...validEvaluation,
        pros: ["p".repeat(401), "Too long"],
      }).success,
    ).toBe(false)
  })
})
