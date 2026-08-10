import { describe, expect, it } from "vitest"

import {
  buildJudgePrompt,
  buildOpeningPrompt,
  buildRebuttalPrompt,
  type DebateCandidate,
  type DebateCandidateResearch,
  type DebateContext,
} from "./context.ts"

const context: DebateContext = {
  userRequest: "Choose a product",
  researchBriefing: "Shared briefing",
  deepSearchResults: [
    { researchRequest: "Shared request", answer: "Shared answer" },
  ],
}
const first: DebateCandidate = {
  ideaId: "first-id",
  title: "Improved first idea",
  description: "Improved first description",
}
const second: DebateCandidate = {
  ideaId: "second-id",
  title: "Improved second idea",
  description: "Improved second description",
}
const firstResearch: DebateCandidateResearch = {
  researchRequest: "Private first request",
  answer: "Private first answer",
}
const secondResearch: DebateCandidateResearch = {
  researchRequest: "Private second request",
  answer: "Private second answer",
}

describe("debate prompt context", () => {
  it("gives an advocate only its assigned candidate research", () => {
    const opening = buildOpeningPrompt(
      context,
      first,
      second,
      firstResearch,
    )
    const rebuttal = buildRebuttalPrompt(
      context,
      first,
      second,
      firstResearch,
      "First opening",
      "Second opening",
    )

    for (const prompt of [opening, rebuttal]) {
      expect(prompt).toContain("Private first request")
      expect(prompt).toContain("Private first answer")
      expect(prompt).not.toContain("Private second request")
      expect(prompt).not.toContain("Private second answer")
    }
  })

  it("gives the judge both candidates and both research reports", () => {
    const prompt = buildJudgePrompt(
      context,
      first,
      second,
      firstResearch,
      secondResearch,
      ["First opening", "Second opening", "First rebuttal", "Second rebuttal"],
    )

    expect(prompt).toContain("Improved first idea")
    expect(prompt).toContain("Improved second idea")
    expect(prompt).toContain("Private first answer")
    expect(prompt).toContain("Private second answer")
  })
})
