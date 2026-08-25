import { describe, expect, it } from "vitest"

import type { IdeaJobEvent } from "../../lib/ideaJobs.ts"
import {
  getIdeaPresentation,
  ideaJobReducer,
  initialIdeaJobState,
  type IdeaJobRunState,
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
      { type: "idea-research-completed" },
      {
        type: "idea-evaluation-stream",
        ideaId: "idea-id",
        streamId: "evaluation-id",
      },
      {
        type: "idea-evaluated",
        ideaId: "idea-id",
        pros: ["Clear value", "Practical workflow"],
        cons: ["Data dependency", "Adoption risk"],
        critique: "Promising with a focused pilot.",
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
    expect(state.refinedIdeaResearchCompleted).toBe(true)
    expect(state.ideaEvaluationStreamIds).toEqual({
      "idea-id": "evaluation-id",
    })
  })

  it("keeps explicit Stop terminal through duplicate replay", () => {
    const events: IdeaJobEvent[] = [
      { type: "stop-requested" },
      { type: "stop-requested" },
      { type: "interrupted", message: "Workflow stopped by user" },
      { type: "done" },
      { type: "done" },
    ]

    const state = events.reduce(ideaJobReducer, {
      ...initialIdeaJobState,
      status: "running",
    })

    expect(state.status).toBe("interrupted")
    expect(state.error).toBe("Workflow stopped by user")
  })

  it("derives selected idea presentation through the final assessment", () => {
    const original = {
      ideaId: "idea-id",
      title: "Original title",
      description: "Original description",
      selection: "selected" as const,
    }
    let state: IdeaJobRunState = {
      ...initialIdeaJobState,
      status: "running" as const,
      ideas: [original],
    }

    expect(getIdeaPresentation(original, state).label).toBe("Selected")

    state = ideaJobReducer(state, {
      type: "idea-refinement-stream",
      ideaId: "idea-id",
      streamId: "refinement-id",
    })
    expect(getIdeaPresentation(original, state).label).toBe("Improving")

    state = ideaJobReducer(state, {
      type: "refined-idea",
      ideaId: "idea-id",
      title: "Draft title",
      description: "Draft description",
    })
    const draft = getIdeaPresentation(original, state)
    expect(draft.label).toBe("Researching improved idea")
    expect(draft.displayIdea.title).toBe("Draft title")
    expect(draft.seoIdea.title).toBe("Original title")
    expect(draft.linkHash).toBe("")

    state = ideaJobReducer(state, {
      type: "idea-evaluation-stream",
      ideaId: "idea-id",
      streamId: "evaluation-id",
    })
    expect(getIdeaPresentation(original, state).label).toBe(
      "Assessing improved idea",
    )

    state = ideaJobReducer(state, {
      type: "idea-evaluated",
      ideaId: "idea-id",
      pros: ["Clear value", "Practical workflow"],
      cons: ["Data dependency", "Adoption risk"],
      critique: "Ready after final assessment.",
    })
    const completed = getIdeaPresentation(original, state)
    expect(completed.label).toBe("Improved")
    expect(completed.seoIdea.title).toBe("Draft title")
    expect(completed.linkHash).toBe("#improved-idea")
  })

  it("uses incomplete terminal wording without an active success state", () => {
    const idea = {
      ideaId: "idea-id",
      title: "Original title",
      description: "Original description",
      selection: "selected" as const,
    }
    const presentation = getIdeaPresentation(idea, {
      ...initialIdeaJobState,
      status: "interrupted",
      ideas: [idea],
      refinedIdeas: {
        "idea-id": {
          ideaId: "idea-id",
          title: "Draft title",
          description: "Draft description",
        },
      },
    })

    expect(presentation.label).toBe("Research incomplete")
    expect(presentation.color).toBe("default")
    expect(presentation.isProvisional).toBe(true)
  })

  it("does not attribute a research fan-out failure to every idea", () => {
    const idea = {
      ideaId: "idea-id",
      title: "Original title",
      description: "Original description",
      selection: "selected" as const,
    }
    const presentation = getIdeaPresentation(idea, {
      ...initialIdeaJobState,
      status: "failed",
      failedStage: "idea-research",
      ideas: [idea],
      refinedIdeas: {
        "idea-id": {
          ideaId: "idea-id",
          title: "Draft title",
          description: "Draft description",
        },
      },
      refinedIdeaResearch: {
        "idea-id": {
          deepSearchJobId: "research-id",
          title: "Draft title",
          slug: "draft-title",
          researchRequest: "Research the draft",
        },
      },
    })

    expect(presentation.label).toBe("Research stage incomplete")
    expect(presentation.color).toBe("error")
  })

  it("distinguishes completed and failed work after a partial refinement failure", () => {
    const completedIdea = {
      ideaId: "completed-idea",
      title: "Original title",
      description: "Original description",
      selection: "selected" as const,
    }
    const failedIdea = {
      ideaId: "failed-idea",
      title: "Other title",
      description: "Other description",
      selection: "selected" as const,
    }
    const run: IdeaJobRunState = {
      ...initialIdeaJobState,
      status: "failed",
      failedStage: "refinement",
      ideas: [completedIdea, failedIdea],
      refinementGenerationStreamIds: {
        "completed-idea": "completed-refinement",
        "failed-idea": "failed-refinement",
      },
      refinedIdeas: {
        "completed-idea": {
          ideaId: "completed-idea",
          title: "Draft title",
          description: "Draft description",
        },
      },
    }

    const completedPresentation = getIdeaPresentation(completedIdea, run)
    const failedPresentation = getIdeaPresentation(failedIdea, run)

    expect(completedPresentation.label).toBe("Research not started")
    expect(completedPresentation.color).toBe("default")
    expect(completedPresentation.isProvisional).toBe(true)
    expect(failedPresentation.label).toBe("Improvement failed")
    expect(failedPresentation.color).toBe("error")
    expect(failedPresentation.isProvisional).toBe(false)
  })

  it("uses the research-completed event before per-idea assessment starts", () => {
    const firstIdea = {
      ideaId: "first-idea",
      title: "First original",
      description: "First original description",
      selection: "selected" as const,
    }
    const queuedIdea = {
      ideaId: "queued-idea",
      title: "Queued original",
      description: "Queued original description",
      selection: "selected" as const,
    }
    const state: IdeaJobRunState = {
      ...initialIdeaJobState,
      status: "running",
      ideas: [firstIdea, queuedIdea],
      refinedIdeas: {
        "first-idea": {
          ideaId: "first-idea",
          title: "First draft",
          description: "First draft description",
        },
        "queued-idea": {
          ideaId: "queued-idea",
          title: "Queued draft",
          description: "Queued draft description",
        },
      },
      ideaEvaluationStreamIds: { "first-idea": "first-evaluation" },
    }
    const queuedState: IdeaJobRunState = {
      ...state,
      refinedIdeaResearchCompleted: true,
      ideaEvaluationStreamIds: {},
    }

    expect(getIdeaPresentation(firstIdea, queuedState).label).toBe(
      "Waiting for assessment",
    )
    expect(getIdeaPresentation(queuedIdea, queuedState).label).toBe(
      "Waiting for assessment",
    )

    expect(getIdeaPresentation(firstIdea, state).label).toBe(
      "Assessing improved idea",
    )
    expect(getIdeaPresentation(queuedIdea, state).label).toBe(
      "Waiting for assessment",
    )
    expect(
      getIdeaPresentation(queuedIdea, {
        ...state,
        status: "interrupted",
      }).label,
    ).toBe("Assessment incomplete")
  })
})
