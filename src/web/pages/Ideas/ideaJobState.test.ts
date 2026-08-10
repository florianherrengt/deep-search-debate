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
