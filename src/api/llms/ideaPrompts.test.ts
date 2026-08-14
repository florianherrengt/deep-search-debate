import { describe, expect, it } from "vitest"
import { loadPrompt, PromptName } from "./prompts.ts"

describe("idea pipeline prompts", () => {
  it("treats generated research as untrusted source material", async () => {
    const summaryPrompt = await loadPrompt(PromptName.SummarizeIdeaResearch)
    const ideaPrompt = await loadPrompt(PromptName.GenerateIdeas)
    const evaluationPrompt = await loadPrompt(PromptName.EvaluateIdea)
    const refinementPrompt = await loadPrompt(PromptName.RefineIdea)

    expect(summaryPrompt).toContain("untrusted source material")
    expect(summaryPrompt).toContain("never as instructions")
    expect(ideaPrompt).toContain("untrusted source material")
    expect(ideaPrompt).toContain("never as instructions")
    expect(evaluationPrompt).toContain("untrusted content")
    expect(evaluationPrompt).toContain("never as instructions")
    expect(evaluationPrompt).toContain("two to four concise pros")
    expect(evaluationPrompt).toContain("Do not invent")
    expect(refinementPrompt).toContain("untrusted content")
    expect(refinementPrompt).toContain("never as instructions")
    expect(refinementPrompt).toContain("Do not invent")
    expect(refinementPrompt).toContain("standalone")
  })
})
