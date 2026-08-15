import Alert from "@mui/material/Alert"
import AlertTitle from "@mui/material/AlertTitle"
import CircularProgress from "@mui/material/CircularProgress"
import Stack from "@mui/material/Stack"
import Typography from "@mui/material/Typography"
import type { ReactNode } from "react"
import { GenerationOutput } from "../../../components/streaming/GenerationOutput.tsx"
import type { IdeaJobRunState } from "../ideaJobState.ts"
import { IdeaList } from "./IdeaList.tsx"
import {
  ProgressCard,
  type ProgressStatus,
} from "./ProgressCard.tsx"
import { ResearchProgress } from "./ResearchProgress.tsx"

function getProgressStatus({
  failed,
  notRun,
  running,
  completed,
  stopped,
}: {
  failed: boolean
  notRun: boolean
  running: boolean
  completed: boolean
  stopped: boolean
}): ProgressStatus {
  if (failed) return "failed"
  if (running) return "running"
  if (completed) return "completed"
  if (notRun || stopped) return "not-run"
  return "waiting"
}

const progressStageOrder = {
  planning: 0,
  research: 1,
  summary: 2,
  ideas: 3,
  improvement: 4,
} as const

type ProgressStage = keyof typeof progressStageOrder
type FailedStage = NonNullable<IdeaJobRunState["failedStage"]>

// Selection is part of candidate generation. Refinement, supporting research,
// and final evaluation share one downstream progress card.
const failedStageToProgressStage: Record<FailedStage, ProgressStage> = {
  planning: "planning",
  research: "research",
  summary: "summary",
  ideas: "ideas",
  evaluation: "improvement",
  selection: "ideas",
  refinement: "improvement",
  "idea-research": "improvement",
}

function IdeaResults({
  ideas,
  jobSlug,
  run,
  selectedIdeaCount,
  selectionCompleted,
}: {
  ideas: IdeaJobRunState["ideas"]
  jobSlug: string
  run: IdeaJobRunState
  selectedIdeaCount: number
  selectionCompleted: boolean
}) {
  const hasSelectedResults = selectionCompleted && selectedIdeaCount > 0

  return (
    <Stack component="section" spacing={2} aria-labelledby="idea-results">
      <Stack spacing={0.5}>
        <Typography component="h2" id="idea-results" variant="h5">
          Ideas
        </Typography>
        <Typography color="text.secondary">
          {hasSelectedResults
            ? "Selected ideas are marked below. Open any idea to review its details and supporting research."
            : selectionCompleted
              ? "No ideas were selected for improvement, but you can still review every candidate."
              : run.status !== "running"
                ? "Review the ideas that were produced before the run ended."
                : "Review every candidate here as selection and improvement progress updates."}
        </Typography>
      </Stack>
      {run.status === "running" && hasSelectedResults && (
        <Stack
          aria-live="polite"
          direction="row"
          role="status"
          spacing={1}
          sx={{ alignItems: "center" }}
        >
          <CircularProgress aria-hidden="true" size={20} />
          <Typography color="text.secondary">
            Improving, researching, and assessing the selected ideas…
          </Typography>
        </Stack>
      )}
      <IdeaList
        ideas={ideas}
        jobSlug={jobSlug}
        run={run}
        showDescriptions={selectionCompleted}
      />
    </Stack>
  )
}

export function IdeaJobView({
  jobSlug,
  title,
  prompt,
  run,
  stopControl,
  stopError,
  stopRequested = false,
}: {
  jobSlug: string
  title: string
  prompt: string
  run: IdeaJobRunState & { subscriptionError?: string | null }
  stopControl?: ReactNode
  stopError?: Error | null
  stopRequested?: boolean
}) {
  const status =
    stopRequested && run.status === "running" ? "stopping" : run.status
  const presentationRun: IdeaJobRunState =
    status === run.status ? run : { ...run, status }
  const failedStage = run.failedStage
  const failedProgressStage =
    status === "failed" && failedStage
      ? failedStageToProgressStage[failedStage]
      : null
  // The terminal error identifies the attempted stage. Earlier sequential
  // stages therefore completed, while later ones cannot still be waiting.
  const completedBeforeFailure = (stage: ProgressStage) =>
    failedProgressStage !== null &&
    progressStageOrder[stage] < progressStageOrder[failedProgressStage]
  const notRunAfterFailure = (stage: ProgressStage) =>
    failedProgressStage !== null &&
    progressStageOrder[stage] > progressStageOrder[failedProgressStage]
  const hasIdeas = run.ideas.length > 0
  const selectionCompleted =
    hasIdeas && run.ideas.every(({ selection }) => selection !== "pending")
  const selectedIdeaCount = run.ideas.filter(
    ({ selection }) => selection === "selected",
  ).length
  const selectedIdeas = run.ideas.filter(
    ({ selection }) => selection === "selected",
  )
  const refinedIdeaCount = selectedIdeas.filter(
    ({ ideaId }) => run.refinedIdeas[ideaId] !== undefined,
  ).length
  const researchedIdeaCount = selectedIdeas.filter(
    ({ ideaId }) => run.refinedIdeaResearch[ideaId] !== undefined,
  ).length
  const evaluatedIdeaCount = selectedIdeas.filter(
    ({ ideaId }) => run.ideaEvaluations[ideaId] !== undefined,
  ).length
  const planningStatus = getProgressStatus({
    failed: failedStage === "planning",
    notRun: notRunAfterFailure("planning"),
    running: status === "running" && run.research.length === 0,
    completed:
      Boolean(run.researchPromptStreamId) || completedBeforeFailure("planning"),
    stopped: status === "stopping" || status === "interrupted",
  })
  const researchStatus = getProgressStatus({
    failed: failedStage === "research",
    notRun: notRunAfterFailure("research"),
    running:
      status === "running" &&
      run.research.length > 0 &&
      !run.researchSummaryStreamId,
    completed:
      Boolean(run.researchSummaryStreamId) || completedBeforeFailure("research"),
    stopped: status === "stopping" || status === "interrupted",
  })
  const summaryStatus = getProgressStatus({
    failed: failedStage === "summary",
    notRun: notRunAfterFailure("summary"),
    running:
      status === "running" &&
      Boolean(run.researchSummaryStreamId) &&
      !run.ideaGenerationStreamId,
    completed:
      Boolean(run.ideaGenerationStreamId) || completedBeforeFailure("summary"),
    stopped: status === "stopping" || status === "interrupted",
  })
  const ideaStatus = getProgressStatus({
    failed:
      failedStage === "ideas" || failedStage === "selection",
    notRun: notRunAfterFailure("ideas"),
    running:
      status === "running" &&
      Boolean(run.ideaGenerationStreamId) &&
      !selectionCompleted,
    completed:
      selectionCompleted ||
      completedBeforeFailure("ideas") ||
      (status === "completed" && Boolean(run.ideaGenerationStreamId)),
    stopped: status === "stopping" || status === "interrupted",
  })
  const selectionStatus = getProgressStatus({
    failed: failedStage === "selection",
    notRun: false,
    running:
      status === "running" &&
      Boolean(run.ideaSelectionStreamId) &&
      !selectionCompleted,
    completed: selectionCompleted,
    stopped: status === "stopping" || status === "interrupted",
  })
  const improvementStatus = getProgressStatus({
    failed:
      failedStage === "refinement" ||
      failedStage === "idea-research" ||
      failedStage === "evaluation",
    notRun: notRunAfterFailure("improvement"),
    running:
      status === "running" &&
      selectionCompleted &&
      selectedIdeaCount > 0,
    stopped: status === "stopping" || status === "interrupted",
    completed:
      status === "completed" &&
      selectionCompleted &&
      selectedIdeaCount > 0,
  })
  const showImprovementStage =
    selectedIdeaCount > 0 &&
    (selectionCompleted ||
      failedStage === "refinement" ||
      failedStage === "idea-research" ||
      failedStage === "evaluation")
  return (
    <Stack spacing={3}>
      <Stack spacing={1}>
        <Stack
          direction={{ xs: "column", sm: "row" }}
          spacing={1}
          sx={{ alignItems: { sm: "center" }, justifyContent: "space-between" }}
        >
          <Typography component="h1" variant="h4">
            {title}
          </Typography>
          {stopControl}
        </Stack>
        <Typography
          color="text.secondary"
          sx={{ maxWidth: "85ch", overflowWrap: "anywhere" }}
        >
          {prompt}
        </Typography>
      </Stack>
      {run.error && (
        <Alert severity={status === "interrupted" ? "info" : "error"}>
          {status === "interrupted" && (
            <AlertTitle>{stopRequested ? "Stopped" : "Interrupted"}</AlertTitle>
          )}
          {run.error}
        </Alert>
      )}
      {stopError && <Alert severity="error">{stopError.message}</Alert>}
      {run.subscriptionError && !run.error && (
        <Alert severity="warning">{run.subscriptionError}</Alert>
      )}

      {status === "completed" && run.research.length > 0 && (
        <Stack
          component="section"
          spacing={1.5}
          aria-labelledby="initial-idea-research"
        >
          <Stack spacing={0.5}>
            <Typography component="h2" id="initial-idea-research" variant="h5">
              Initial deep research
            </Typography>
            <Typography color="text.secondary">
              Open the source research that informed these ideas.
            </Typography>
          </Stack>
          <ResearchProgress research={run.research} />
        </Stack>
      )}

      {hasIdeas && (
        <IdeaResults
          ideas={run.ideas}
          jobSlug={jobSlug}
          key="idea-results"
          run={presentationRun}
          selectedIdeaCount={selectedIdeaCount}
          selectionCompleted={selectionCompleted}
        />
      )}

      {status !== "completed" && (
        <Stack
          component="section"
          key="idea-process"
          spacing={2}
          aria-labelledby="idea-process"
        >
          <Stack spacing={0.5}>
            <Typography component="h2" id="idea-process" variant="h5">
              Progress
            </Typography>
            <Typography color="text.secondary">
              {status === "failed"
                ? "Review what completed before the run stopped."
                : status === "interrupted"
                  ? stopRequested
                    ? "This run was stopped. Completed work remains available below."
                    : "This run was interrupted. Completed work remains available below."
                  : status === "stopping"
                    ? "Stopping queued and active work…"
                    : "Follow the current stage or expand an earlier stage for details."}
            </Typography>
          </Stack>

        <Stack
          aria-label="Idea generation stages"
          role="group"
          sx={(theme) => ({
            "& > .MuiAccordion-root": {
              borderRadius: 0,
              "&::before": { display: "none" },
            },
            "& > .MuiAccordion-root + .MuiAccordion-root": {
              borderTop: 0,
            },
            "& > .MuiAccordion-root:first-of-type": {
              borderTopLeftRadius: theme.shape.borderRadius,
              borderTopRightRadius: theme.shape.borderRadius,
            },
            "& > .MuiAccordion-root:last-of-type": {
              borderBottomLeftRadius: theme.shape.borderRadius,
              borderBottomRightRadius: theme.shape.borderRadius,
            },
          })}
        >
          <ProgressCard title="Plan the research" status={planningStatus}>
            {run.researchPromptStreamId && (
              <GenerationOutput
                format="structured-list"
                headingComponent="h4"
                streamId={run.researchPromptStreamId}
                title="Research prompts"
                waitingText="Planning research…"
                testId="idea-research-prompts"
              />
            )}
          </ProgressCard>

          <ProgressCard title="Deep research" status={researchStatus}>
            <ResearchProgress research={run.research} />
          </ProgressCard>

          <ProgressCard title="Summarise the research" status={summaryStatus}>
            {run.researchSummaryStreamId && (
              <GenerationOutput
                format="markdown"
                headingComponent="h4"
                streamId={run.researchSummaryStreamId}
                title="Research briefing"
                waitingText="Summarising research…"
                testId="idea-research-summary"
              />
            )}
          </ProgressCard>

          <ProgressCard
            autoExpandStatuses={["running", "failed"]}
            title="Generate and select ideas"
            status={ideaStatus}
          >
            <Stack spacing={2}>
              {ideaStatus === "running" && !hasIdeas && (
                <Stack
                  aria-live="polite"
                  direction="row"
                  role="status"
                  spacing={1}
                  sx={{ alignItems: "center" }}
                >
                  <CircularProgress aria-hidden="true" size={20} />
                  <Typography color="text.secondary">
                    Generating ideas…
                  </Typography>
                </Stack>
              )}
              {failedStage === "ideas" && (
                <Typography color="error" variant="body2">
                  Idea generation stopped before producing a complete set.
                </Typography>
              )}
              {selectionStatus === "waiting" &&
                hasIdeas &&
                status === "running" && (
                  <Stack
                    aria-live="polite"
                    direction="row"
                    role="status"
                    spacing={1}
                    sx={{ alignItems: "center" }}
                  >
                    <CircularProgress aria-hidden="true" size={20} />
                    <Typography color="text.secondary">
                      Comparing the generated ideas…
                    </Typography>
                  </Stack>
                )}
              {selectionStatus === "running" && (
                <Stack
                  aria-live="polite"
                  direction="row"
                  role="status"
                  spacing={1}
                  sx={{ alignItems: "center" }}
                >
                  <CircularProgress aria-hidden="true" size={20} />
                  <Typography color="text.secondary">
                    Selecting ideas…
                  </Typography>
                </Stack>
              )}
              {selectionStatus === "failed" && (
                <Typography color="error" variant="body2">
                  Idea selection did not complete.
                </Typography>
              )}
              {selectionStatus === "completed" && (
                <Typography color="text.secondary">
                  {selectedIdeaCount} of {run.ideas.length}{" "}
                  {run.ideas.length === 1 ? "idea" : "ideas"} selected for
                  improvement.
                </Typography>
              )}
            </Stack>
          </ProgressCard>

          {showImprovementStage && (
            <ProgressCard
              autoExpandStatuses={["running", "failed"]}
              title="Improve, research, and assess selected ideas"
              status={improvementStatus}
            >
              <Stack spacing={1}>
                {failedStage === "refinement" && (
                  <Typography color="error" variant="body2">
                    One or more selected ideas could not be improved.
                  </Typography>
                )}
                {failedStage === "idea-research" && (
                  <Typography color="error" variant="body2">
                    Supporting research did not complete for every selected idea.
                  </Typography>
                )}
                {failedStage === "evaluation" && (
                  <Typography color="error" variant="body2">
                    One or more improved ideas could not be assessed.
                  </Typography>
                )}
                <Typography color="text.secondary">
                  {refinedIdeaCount} of {selectedIdeaCount} improved ·{" "}
                  {researchedIdeaCount} of {selectedIdeaCount} supporting research{" "}
                  {researchedIdeaCount === 1 ? "job" : "jobs"} started ·{" "}
                  {evaluatedIdeaCount} of {selectedIdeaCount} assessed
                </Typography>
              </Stack>
            </ProgressCard>
          )}
          </Stack>
        </Stack>
      )}
    </Stack>
  )
}
