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
  refinedIdeaResearchCompleted?: boolean
  ideaEvaluationStreamIds?: Record<string, string>
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
  refinedIdeaResearchCompleted: false,
  ideaEvaluationStreamIds: {},
  error: null,
}

export type IdeaPresentation = {
  color: "default" | "primary" | "success" | "error"
  displayIdea: Idea
  isFinal: boolean
  isProvisional: boolean
  label: string
  linkHash: "#improved-idea" | ""
  seoIdea: Idea
}

/** Derives the durable boundary between improved-idea research and assessment. */
export function hasRefinedIdeaResearchCompleted(
  run: IdeaJobRunState,
): boolean {
  return (
    run.refinedIdeaResearchCompleted === true ||
    run.failedStage === "evaluation" ||
    Object.keys(run.ideaEvaluationStreamIds ?? {}).length > 0 ||
    Object.keys(run.ideaEvaluations).length > 0
  )
}

/** Derives the single user-facing lifecycle for an idea across every surface. */
export function getIdeaPresentation(
  idea: IdeaJobRunState["ideas"][number],
  run: IdeaJobRunState,
): IdeaPresentation {
  const refinedIdea = run.refinedIdeas[idea.ideaId]
  const finalEvaluation = run.ideaEvaluations[idea.ideaId]
  const displayIdea = refinedIdea ?? idea
  const isFinal = finalEvaluation !== undefined
  const base = {
    displayIdea,
    isFinal,
    isProvisional: refinedIdea !== undefined && !isFinal,
    linkHash: isFinal && refinedIdea ? ("#improved-idea" as const) : ("" as const),
    seoIdea: isFinal && refinedIdea ? refinedIdea : idea,
  }

  if (idea.selection === "rejected") {
    return { ...base, color: "default", label: "Not selected" }
  }
  if (idea.selection === "pending") {
    return run.status === "running"
      ? { ...base, color: "default", label: "Awaiting selection" }
      : { ...base, color: "error", label: "Selection incomplete" }
  }
  if (isFinal) {
    return { ...base, color: "success", label: "Improved" }
  }

  const evaluationStarted =
    run.ideaEvaluationStreamIds?.[idea.ideaId] !== undefined
  const refinedResearchCompleted = hasRefinedIdeaResearchCompleted(run)
  const researchStarted = run.refinedIdeaResearch[idea.ideaId] !== undefined
  const refinementStarted =
    run.refinementGenerationStreamIds[idea.ideaId] !== undefined

  if (run.status === "running") {
    if (evaluationStarted) {
      return { ...base, color: "primary", label: "Assessing improved idea" }
    }
    if (refinedResearchCompleted) {
      return { ...base, color: "primary", label: "Waiting for assessment" }
    }
    if (refinedIdea || researchStarted) {
      return { ...base, color: "primary", label: "Researching improved idea" }
    }
    if (refinementStarted) {
      return { ...base, color: "primary", label: "Improving" }
    }
    return { ...base, color: "primary", label: "Selected" }
  }

  if (run.status === "failed") {
    if (run.failedStage === "evaluation") {
      return { ...base, color: "error", label: "Assessment failed" }
    }
    if (run.failedStage === "idea-research") {
      return { ...base, color: "error", label: "Research stage incomplete" }
    }
    if (run.failedStage === "refinement") {
      return refinedIdea
        ? { ...base, color: "default", label: "Research not started" }
        : { ...base, color: "error", label: "Improvement failed" }
    }
    if (evaluationStarted) {
      return { ...base, color: "error", label: "Assessment failed" }
    }
    if (refinedIdea || researchStarted) {
      return { ...base, color: "error", label: "Research failed" }
    }
    if (refinementStarted) {
      return { ...base, color: "error", label: "Improvement failed" }
    }
  }

  if (evaluationStarted || refinedResearchCompleted) {
    return { ...base, color: "default", label: "Assessment incomplete" }
  }
  if (refinedIdea || researchStarted) {
    return { ...base, color: "default", label: "Research incomplete" }
  }
  if (refinementStarted) {
    return { ...base, color: "default", label: "Improvement incomplete" }
  }
  return { ...base, color: "default", label: "Improvement not started" }
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
      case "idea-research-completed":
        state.refinedIdeaResearchCompleted = true
        break
      case "idea-evaluation-stream":
        state.ideaEvaluationStreamIds ??= {}
        state.ideaEvaluationStreamIds[action.ideaId] = action.streamId
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
