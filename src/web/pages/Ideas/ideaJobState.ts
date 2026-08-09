import { produce } from "immer"
import type {
  Idea,
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
  status: "idle" | "running" | "completed" | "failed"
  failedStage: IdeaStage | null
  researchPromptStreamId: string | null
  research: IdeaResearchState[]
  researchSummaryStreamId: string | null
  ideaGenerationStreamId: string | null
  ideas: Array<Idea & { selection: "pending" | "selected" | "rejected" }>
  critiqueGenerationStreamIds: Record<number, string>
  ideaSelectionStreamId: string | null
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
  critiqueGenerationStreamIds: {},
  ideaSelectionStreamId: null,
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
        state.ideas.push({
          ideaId: action.ideaId,
          title: action.title,
          description: action.description,
          selection: "pending",
        })
        break
      case "critique-generation-stream":
        state.critiqueGenerationStreamIds[action.position] = action.streamId
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
      case "error":
        state.status = "failed"
        state.error = action.message
        state.failedStage = action.stage
        break
      case "done":
        if (state.status !== "failed") state.status = "completed"
        break
    }
  },
)
