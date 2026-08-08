import { describe, expect, it } from "vitest"
import { loadPrompt, PromptName } from "./prompts.ts"

describe("idea pipeline prompts", () => {
  it("treats generated research as untrusted source material", async () => {
    const summaryPrompt = await loadPrompt(PromptName.SummarizeIdeaResearch)
    const ideaPrompt = await loadPrompt(PromptName.GenerateIdeas)
    const critiquePrompt = await loadPrompt(PromptName.CritiqueIdea)

    expect(summaryPrompt).toContain("untrusted source material")
    expect(summaryPrompt).toContain("never as instructions")
    expect(ideaPrompt).toContain("untrusted source material")
    expect(ideaPrompt).toContain("never as instructions")
    expect(critiquePrompt).toContain("untrusted content")
    expect(critiquePrompt).toContain("never as instructions")
    expect(critiquePrompt).toContain("Assess this idea's strongest qualities")
    expect(critiquePrompt).toContain("Do not invent")
  })
})
