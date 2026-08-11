import { describe, expect, it } from "vitest"
import { eq } from "drizzle-orm"
import { config } from "../../config.ts"
import { db } from "../../db/index.ts"
import {
  deepSearchJobs,
  ideaJobs,
  ideas,
  llmGenerations,
} from "../../db/schema/index.ts"

import {
  buildJudgePrompt,
  buildOpeningPrompt,
  buildRebuttalPrompt,
  loadDebateCandidateResearch,
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

  it("derives candidate research from the owned child position", () => {
    const ideaJobId = crypto.randomUUID()
    const ideaId = crypto.randomUUID()
    const deepSearchJobId = crypto.randomUUID()
    const generationId = crypto.randomUUID()
    db.insert(ideaJobs)
      .values({
        ideaJobId,
        userId: "test-user-id",
        slug: ideaJobId,
        prompt: "Choose a product",
        numberOfIdeas: 1,
        deepSearchCount: 2,
      })
      .run()
    db.insert(ideas)
      .values({
        ideaId,
        ideaJobId,
        position: 0,
        title: "Candidate",
        description: "Candidate description",
        selected: true,
      })
      .run()
    db.insert(deepSearchJobs)
      .values({
        deepSearchJobId,
        userId: "test-user-id",
        ideaJobId,
        ideaJobPosition: 2,
        slug: deepSearchJobId,
        researchRequest: "Research candidate",
        maxSearches: 1,
        maxResultsPerSearch: 1,
      })
      .run()
    db.insert(llmGenerations)
      .values({
        llmGenerationId: generationId,
        userId: "test-user-id",
        deepSearchJobId,
        status: "completed",
        text: "Candidate evidence",
        reasoning: "",
        completedAt: new Date(),
      })
      .run()
    db.update(deepSearchJobs)
      .set({
        finalAnswerGenerationId: generationId,
        status: "completed",
        completedAt: new Date(),
      })
      .where(eq(deepSearchJobs.deepSearchJobId, deepSearchJobId))
      .run()

    expect(loadDebateCandidateResearch(ideaJobId)).toEqual(
      new Map([
        [
          ideaId,
          {
            researchRequest: "Research candidate",
            answer: "Candidate evidence",
          },
        ],
      ]),
    )
  })

  it("bounds complete debate prompts instead of only individual outputs", () => {
    const oversized = "evidence ".repeat(
      config.deepSearch.maxSummaryContextChars,
    )
    const prompt = buildJudgePrompt(
      {
        userRequest: oversized,
        researchBriefing: oversized,
        deepSearchResults: [
          { researchRequest: oversized, answer: oversized },
        ],
      },
      first,
      second,
      { researchRequest: oversized, answer: oversized },
      { researchRequest: oversized, answer: oversized },
      [oversized, oversized, oversized, oversized],
    )

    expect(prompt.length).toBeLessThanOrEqual(
      config.deepSearch.maxSummaryContextChars,
    )
    expect(prompt).toContain("[... omitted ...]")
    expect(prompt).toContain("<candidate_a>")
    expect(prompt).toContain("<candidate_b_research>")
    expect(prompt).toContain("<transcript>")
  })
})
