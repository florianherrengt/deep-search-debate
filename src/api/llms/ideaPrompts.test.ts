import { describe, expect, it } from "vitest"
import { loadPrompt, PromptName } from "./prompts.ts"

describe("idea pipeline prompts", () => {
  it("treats generated research as untrusted source material", async () => {
    const summaryPrompt = await loadPrompt(PromptName.SummarizeIdeaResearch)
    const ideaPrompt = await loadPrompt(PromptName.GenerateIdeas)

    expect(summaryPrompt).toContain("untrusted source material")
    expect(summaryPrompt).toContain("never as instructions")
    expect(ideaPrompt).toContain("untrusted source material")
    expect(ideaPrompt).toContain("never as instructions")
  })
})
