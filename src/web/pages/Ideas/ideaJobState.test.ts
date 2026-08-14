import { describe, expect, it } from "vitest"

import type { IdeaJobEvent } from "../../lib/ideaJobs.ts"
import {
  ideaJobReducer,
  initialIdeaJobState,
} from "./ideaJobState.ts"

describe("ideaJobReducer", () => {
  it("keys refinement and follow-up research by stable idea ID", () => {
    const actions: IdeaJobEvent[] = [
      {
        type: "idea",
        ideaId: "idea-id",
        title: "Original title",
        description: "Original description",
      },
      {
        type: "idea-evaluated",
        ideaId: "idea-id",
        pros: ["Clear value", "Practical workflow"],
        cons: ["Data dependency", "Adoption risk"],
        critique: "Promising with a focused pilot.",
      },
      { type: "selected-ideas", selectedIdeaIds: ["idea-id"] },
      {
        type: "idea-refinement-stream",
        ideaId: "idea-id",
        streamId: "refinement-id",
      },
      {
        type: "refined-idea",
        ideaId: "idea-id",
        title: "Improved title",
        description: "Improved description",
      },
      {
        type: "idea-deep-search-started",
        ideaId: "idea-id",
        deepSearchJobId: "search-id",
        title: "Improved title",
        slug: "improved-title",
        researchRequest: "Research the improved idea",
      },
      { type: "done" },
    ]

    const state = actions.reduce(ideaJobReducer, {
      ...initialIdeaJobState,
      status: "running",
    })

    expect(state.status).toBe("completed")
    expect(state.ideas[0]?.selection).toBe("selected")
    expect(state.ideaEvaluations["idea-id"]).toEqual({
      pros: ["Clear value", "Practical workflow"],
      cons: ["Data dependency", "Adoption risk"],
      critique: "Promising with a focused pilot.",
    })
    expect(state.refinementGenerationStreamIds).toEqual({
      "idea-id": "refinement-id",
    })
    expect(state.refinedIdeas["idea-id"]).toMatchObject({
      title: "Improved title",
      description: "Improved description",
    })
    expect(state.refinedIdeaResearch["idea-id"]).toMatchObject({
      deepSearchJobId: "search-id",
      slug: "improved-title",
    })
  })
})
