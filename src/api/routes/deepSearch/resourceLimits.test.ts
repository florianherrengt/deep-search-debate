import { describe, expect, it } from "vitest"
import { config } from "../../config.ts"
import {
  createIdeaJobInputSchema,
  ideaSelectionSchema,
} from "../ideas/schemas.ts"
import { deepSearchExecutionInputSchema } from "./resourceLimits.ts"

describe("deep-search resource limits", () => {
  it("applies bounded search and round defaults", () => {
    expect(
      deepSearchExecutionInputSchema.parse({ researchRequest: "Research this" }),
    ).toEqual({
      researchRequest: "Research this",
      maxSearches: 3,
      maxResultsPerSearch: 3,
      maxRounds: 3,
    })
  })

  it("rejects work above an individual search ceiling", () => {
    const result = deepSearchExecutionInputSchema.safeParse({
      researchRequest: "Research this",
      maxSearches: config.deepSearch.maxSearches + 1,
      maxResultsPerSearch: 1,
    })

    expect(result.success).toBe(false)
  })

  it("rejects work above the per-round selected-URL budget", () => {
    const result = deepSearchExecutionInputSchema.safeParse({
      researchRequest: "Research this",
      maxSearches: 10,
      maxResultsPerSearch: 4,
    })

    expect(result.success).toBe(false)
    if (result.success) throw new Error("Expected resource validation to fail")
    expect(result.error.issues[0]?.path).toEqual(["maxResultsPerSearch"])
    expect(result.error.issues[0]?.message).toContain("30 selected URLs")
  })

  it("rejects work above the configured round ceiling", () => {
    expect(
      deepSearchExecutionInputSchema.safeParse({
        researchRequest: "Research this",
        maxRounds: config.deepSearch.maxRounds + 1,
      }).success,
    ).toBe(false)
  })

  it("rejects oversized standalone and idea-owned research requests", () => {
    const oversizedPrompt = "x".repeat(config.deepSearch.maxRequestChars + 1)

    expect(
      deepSearchExecutionInputSchema.safeParse({
        researchRequest: oversizedPrompt,
      }).success,
    ).toBe(false)
    expect(
      createIdeaJobInputSchema.safeParse({ prompt: oversizedPrompt }).success,
    ).toBe(false)
  })

  it("caps the number of initial child searches in an idea job", () => {
    expect(
      createIdeaJobInputSchema.safeParse({
        prompt: "Generate ideas",
        deepSearchCount: config.deepSearch.maxInitialIdeaSearches + 1,
      }).success,
    ).toBe(false)
  })

  it("caps generated ideas at 20 and selected ideas at 12", () => {
    expect(
      createIdeaJobInputSchema.safeParse({
        prompt: "Generate ideas",
        numberOfIdeas: 21,
      }).success,
    ).toBe(false)
    expect(
      ideaSelectionSchema.safeParse({
        selectedIdeaIds: Array.from({ length: 14 }, () => crypto.randomUUID()),
      }).success,
    ).toBe(false)
  })

  it("applies the selected-URL budget to idea-owned searches", () => {
    expect(
      createIdeaJobInputSchema.safeParse({
        prompt: "Generate ideas",
        maxSearches: 10,
        maxResultsPerSearch: 4,
      }).success,
    ).toBe(false)
  })

  it("caps the aggregate selected-page budget across every idea-job child", () => {
    const result = createIdeaJobInputSchema.safeParse({
      prompt: "Generate ideas",
      numberOfIdeas: 20,
      deepSearchCount: config.deepSearch.maxInitialIdeaSearches,
      maxSearches: 10,
      maxResultsPerSearch: 3,
      maxRounds: 3,
    })

    expect(result.success).toBe(false)
    if (result.success) throw new Error("Expected resource validation to fail")
    const issue = result.error.issues.find(
      ({ path }) => path.length === 1 && path[0] === "maxRounds",
    )
    expect(issue?.message).toContain(
      `${config.deepSearch.maxSelectedPagesPerRootJob} selected pages`,
    )
  })
})
