import { produce } from "immer"
import type {
  Idea,
  IdeaJobEvent,
  IdeaStage,
} from "../../lib/ideaJobs.ts"

export type IdeaResearchState = {
  deepSearchJobId: string
  researchRequest: string
}

export type IdeaJobRunState = {
  status: "idle" | "running" | "completed" | "failed"
  failedStage: IdeaStage | null
  researchPromptStreamId: string | null
  research: IdeaResearchState[]
  researchSummaryStreamId: string | null
  ideaGenerationStreamId: string | null
  ideas: Idea[]
  critiqueGenerationStreamIds: Record<number, string>
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
          title: action.title,
          description: action.description,
        })
        break
      case "critique-generation-stream":
        state.critiqueGenerationStreamIds[action.position] = action.streamId
        break
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
