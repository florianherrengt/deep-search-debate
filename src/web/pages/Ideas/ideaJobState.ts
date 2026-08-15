import { produce } from "immer"
import type {
  Idea,
  IdeaEvaluation,
  IdeaJobEvent,
  IdeaStage,
} from "../../lib/ideaJobs.ts"

export type IdeaResearchState = {
  deepSearchJobId: string
  title: string
  slug: string
  researchRequest: string
}

export type IdeaJobRunState = {
  status:
    | "idle"
    | "running"
    | "stopping"
    | "completed"
    | "failed"
    | "interrupted"
  failedStage: IdeaStage | null
  researchPromptStreamId: string | null
  research: IdeaResearchState[]
  researchSummaryStreamId: string | null
  ideaGenerationStreamId: string | null
  ideas: Array<Idea & { selection: "pending" | "selected" | "rejected" }>
  ideaEvaluations: Record<string, IdeaEvaluation>
  ideaSelectionStreamId: string | null
  refinementGenerationStreamIds: Record<string, string>
  refinedIdeas: Record<string, Idea>
  refinedIdeaResearch: Record<string, IdeaResearchState>
  error: string | null
}

export const initialIdeaJobState: IdeaJobRunState = {
  status: "idle",
  failedStage: null,
  researchPromptStreamId: null,
  research: [],
  researchSummaryStreamId: null,
  ideaGenerationStreamId: null,
  ideas: [],
  ideaEvaluations: {},
  ideaSelectionStreamId: null,
  refinementGenerationStreamIds: {},
  refinedIdeas: {},
  refinedIdeaResearch: {},
  error: null,
}

type IdeaJobAction =
  | IdeaJobEvent
  | { type: "opened" }

/** Folds replayed and live parent-pipeline events into renderable state. */
export const ideaJobReducer = produce<IdeaJobRunState, [IdeaJobAction]>(
  (state, action) => {
    switch (action.type) {
      case "opened":
        return { ...initialIdeaJobState, status: "running" }
      case "research-prompt-stream":
        state.researchPromptStreamId = action.streamId
        break
      case "deep-search-started":
        state.research = state.research.filter(
          ({ deepSearchJobId }) =>
            deepSearchJobId !== action.deepSearchJobId,
        )
        state.research.push({
          deepSearchJobId: action.deepSearchJobId,
          title: action.title,
          slug: action.slug,
          researchRequest: action.researchRequest,
        })
        break
      case "research-summary-stream":
        state.researchSummaryStreamId = action.streamId
        break
      case "idea-generation-stream":
        state.ideaGenerationStreamId = action.streamId
        break
      case "idea":
        state.ideas = state.ideas.filter(
          ({ ideaId }) => ideaId !== action.ideaId,
        )
        state.ideas.push({
          ideaId: action.ideaId,
          title: action.title,
          description: action.description,
          selection: "pending",
        })
        break
      case "idea-evaluated":
        state.ideaEvaluations[action.ideaId] = {
          pros: action.pros,
          cons: action.cons,
          critique: action.critique,
        }
        break
      case "idea-selection-stream":
        state.ideaSelectionStreamId = action.streamId
        break
      case "selected-ideas": {
        const selectedIdeaIds = new Set(action.selectedIdeaIds)
        for (const idea of state.ideas) {
          idea.selection = selectedIdeaIds.has(idea.ideaId)
            ? "selected"
            : "rejected"
        }
        break
      }
      case "idea-refinement-stream":
        state.refinementGenerationStreamIds[action.ideaId] = action.streamId
        break
      case "refined-idea":
        state.refinedIdeas[action.ideaId] = {
          ideaId: action.ideaId,
          title: action.title,
          description: action.description,
        }
        break
      case "idea-deep-search-started":
        state.refinedIdeaResearch[action.ideaId] = {
          deepSearchJobId: action.deepSearchJobId,
          title: action.title,
          slug: action.slug,
          researchRequest: action.researchRequest,
        }
        break
      case "stop-requested":
        if (state.status === "idle" || state.status === "running") {
          state.status = "stopping"
        }
        break
      case "interrupted":
        state.status = "interrupted"
        state.error = action.message
        break
      case "error":
        state.status = "failed"
        state.error = action.message
        state.failedStage = action.stage
        break
      case "done":
        if (
          state.status !== "failed" &&
          state.status !== "interrupted" &&
          state.status !== "stopping"
        ) {
          state.status = "completed"
        }
        break
    }
  },
)
