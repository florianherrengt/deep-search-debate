import Alert from "@mui/material/Alert"
import AlertTitle from "@mui/material/AlertTitle"
import CircularProgress from "@mui/material/CircularProgress"
import Stack from "@mui/material/Stack"
import Typography from "@mui/material/Typography"
import type { ReactNode } from "react"
import { GenerationOutput } from "../../../components/streaming/GenerationOutput.tsx"
import {
  hasRefinedIdeaResearchCompleted,
  type IdeaJobRunState,
} from "../ideaJobState.ts"
import { IdeaList } from "./IdeaList.tsx"
import {
  ProgressCard,
  type ProgressStatus,
} from "./ProgressCard.tsx"
import { ResearchProgress } from "./ResearchProgress.tsx"
import { MarkdownText } from "../../../components/MarkdownText.tsx"

function getProgressStatus({
  failed,
  notRun,
  running,
  completed,
  started,
  stopped,
}: {
  failed: boolean
  notRun: boolean
  running: boolean
  completed: boolean
  started: boolean
  stopped: boolean
}): ProgressStatus {
  if (failed) return "failed"
  if (stopped) {
    if (completed) return "completed"
    return started ? "incomplete" : "not-run"
  }
  if (running) return "running"
  if (completed) return "completed"
  if (notRun) return "not-run"
  return "waiting"
}

const progressStageOrder = {
  planning: 0,
  research: 1,
  summary: 2,
  ideas: 3,
  selection: 4,
  refinement: 5,
  "idea-research": 6,
  evaluation: 7,
} as const

type ProgressStage = keyof typeof progressStageOrder

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
  const anyAssessmentStarted =
    Object.keys(run.ideaEvaluationStreamIds ?? {}).length > 0 ||
    Object.keys(run.ideaEvaluations).length > 0
  const selectedIdeaProgress = anyAssessmentStarted
    ? "Assessing the improved ideas…"
    : hasRefinedIdeaResearchCompleted(run)
      ? "Waiting to assess the improved ideas…"
      : Object.keys(run.refinedIdeaResearch).length > 0
        ? "Researching the improved ideas…"
        : Object.keys(run.refinementGenerationStreamIds).length > 0
          ? "Improving the selected ideas…"
          : "Preparing to improve the selected ideas…"

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
            {selectedIdeaProgress}
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
  feedbackControl,
  jobSlug,
  title,
  prompt,
  run,
  stopControl,
  stopError,
  stopRequested = false,
}: {
  feedbackControl?: ReactNode
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
  const failedProgressStage = status === "failed" ? failedStage : null
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
  const refinementStarted =
    Object.keys(run.refinementGenerationStreamIds).length > 0 ||
    refinedIdeaCount > 0
  const assessmentReachedCount = selectedIdeas.filter(
    ({ ideaId }) =>
      run.ideaEvaluationStreamIds?.[ideaId] !== undefined ||
      run.ideaEvaluations[ideaId] !== undefined,
  ).length
  const refinedResearchCompleted = hasRefinedIdeaResearchCompleted(run)
  const workflowStopped = status === "stopping" || status === "interrupted"
  const planningStatus = getProgressStatus({
    failed: failedStage === "planning",
    notRun: notRunAfterFailure("planning"),
    running: status === "running" && run.research.length === 0,
    completed:
      Boolean(run.researchPromptStreamId) || completedBeforeFailure("planning"),
    started: Boolean(run.researchPromptStreamId),
    stopped: workflowStopped,
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
    started: run.research.length > 0,
    stopped: workflowStopped,
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
    started: Boolean(run.researchSummaryStreamId),
    stopped: workflowStopped,
  })
  const ideaStatus = getProgressStatus({
    failed: failedStage === "ideas",
    notRun: notRunAfterFailure("ideas"),
    running:
      status === "running" &&
      Boolean(run.ideaGenerationStreamId) &&
      !run.ideaSelectionStreamId &&
      !selectionCompleted,
    completed:
      Boolean(run.ideaSelectionStreamId) ||
      selectionCompleted ||
      completedBeforeFailure("ideas") ||
      (status === "completed" && Boolean(run.ideaGenerationStreamId)),
    started: Boolean(run.ideaGenerationStreamId),
    stopped: workflowStopped,
  })
  const selectionStatus = getProgressStatus({
    failed: failedStage === "selection",
    notRun: notRunAfterFailure("selection"),
    running:
      status === "running" &&
      Boolean(run.ideaSelectionStreamId) &&
      !selectionCompleted,
    completed: selectionCompleted,
    started: Boolean(run.ideaSelectionStreamId),
    stopped: workflowStopped,
  })
  const refinementStatus = getProgressStatus({
    failed: failedStage === "refinement",
    notRun: notRunAfterFailure("refinement"),
    running:
      status === "running" &&
      selectionCompleted &&
      selectedIdeaCount > 0 &&
      refinementStarted &&
      refinedIdeaCount < selectedIdeaCount,
    started: refinementStarted,
    stopped: workflowStopped,
    completed:
      (selectedIdeaCount > 0 && refinedIdeaCount === selectedIdeaCount) ||
      completedBeforeFailure("refinement"),
  })
  const refinedResearchStatus = getProgressStatus({
    failed: failedStage === "idea-research",
    notRun: notRunAfterFailure("idea-research"),
    running:
      status === "running" &&
      researchedIdeaCount > 0 &&
      !refinedResearchCompleted,
    completed:
      (selectedIdeaCount > 0 && refinedResearchCompleted) ||
      completedBeforeFailure("idea-research"),
    started: researchedIdeaCount > 0,
    stopped: workflowStopped,
  })
  const assessmentStatus = getProgressStatus({
    failed: failedStage === "evaluation",
    notRun: notRunAfterFailure("evaluation"),
    running:
      status === "running" &&
      assessmentReachedCount > 0 &&
      evaluatedIdeaCount < selectedIdeaCount,
    completed:
      (selectedIdeaCount > 0 && evaluatedIdeaCount === selectedIdeaCount) ||
      completedBeforeFailure("evaluation"),
    started: assessmentReachedCount > 0,
    stopped: workflowStopped,
  })
  const showSelectedIdeaStages =
    selectedIdeaCount > 0 &&
    (selectionCompleted || failedProgressStage === "refinement")
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
        <MarkdownText
          sx={{ maxWidth: "85ch" }}
          text={prompt}
        />
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
      {status === "completed" && feedbackControl}

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
            title="Generate ideas"
            status={ideaStatus}
          >
            {ideaStatus === "running" && !hasIdeas ? (
              <Stack
                aria-live="polite"
                direction="row"
                role="status"
                spacing={1}
                sx={{ alignItems: "center" }}
              >
                <CircularProgress aria-hidden="true" size={20} />
                <Typography color="text.secondary">Generating ideas…</Typography>
              </Stack>
            ) : failedStage === "ideas" ? (
              <Typography color="error" variant="body2">
                Idea generation stopped before producing a complete set.
              </Typography>
            ) : (
              <Typography color="text.secondary">
                {run.ideas.length} {run.ideas.length === 1 ? "idea" : "ideas"}{" "}
                generated.
              </Typography>
            )}
          </ProgressCard>

          <ProgressCard
            autoExpandStatuses={
              hasIdeas
                ? ["waiting", "running", "failed"]
                : ["running", "failed"]
            }
            title="Select ideas"
            status={selectionStatus}
          >
            {selectionStatus === "waiting" && hasIdeas && status === "running" ? (
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
            ) : selectionStatus === "running" ? (
              <Stack
                aria-live="polite"
                direction="row"
                role="status"
                spacing={1}
                sx={{ alignItems: "center" }}
              >
                <CircularProgress aria-hidden="true" size={20} />
                <Typography color="text.secondary">Selecting ideas…</Typography>
              </Stack>
            ) : selectionStatus === "failed" ? (
              <Typography color="error" variant="body2">
                Idea selection did not complete.
              </Typography>
            ) : (
              <Typography color="text.secondary">
                {selectedIdeaCount} of {run.ideas.length}{" "}
                {run.ideas.length === 1 ? "idea" : "ideas"} selected for
                improvement.
              </Typography>
            )}
          </ProgressCard>

          {showSelectedIdeaStages && (
            <>
              <ProgressCard
                autoExpandStatuses={["running", "failed"]}
                title="Refine selected ideas"
                status={refinementStatus}
              >
                <Stack spacing={1}>
                  {failedStage === "refinement" && (
                    <Typography color="error" variant="body2">
                      One or more selected ideas could not be improved.
                    </Typography>
                  )}
                  <Typography color="text.secondary">
                    {refinedIdeaCount} of {selectedIdeaCount} improved drafts ready.
                  </Typography>
                </Stack>
              </ProgressCard>

              <ProgressCard
                autoExpandStatuses={["running", "failed"]}
                title="Research improved ideas"
                status={refinedResearchStatus}
              >
                <Stack spacing={1}>
                  {failedStage === "idea-research" && (
                    <Typography color="error" variant="body2">
                      Supporting research did not complete for every selected idea.
                    </Typography>
                  )}
                  <Typography color="text.secondary">
                    {refinedResearchCompleted
                      ? `Supporting research is complete for all ${selectedIdeaCount} improved ${selectedIdeaCount === 1 ? "idea" : "ideas"}.`
                      : `${researchedIdeaCount} of ${selectedIdeaCount} supporting research ${researchedIdeaCount === 1 ? "job" : "jobs"} started. Research remains in progress until final assessment begins.`}
                  </Typography>
                </Stack>
              </ProgressCard>

              <ProgressCard
                autoExpandStatuses={["running", "failed"]}
                title="Assess improved ideas"
                status={assessmentStatus}
              >
                <Stack spacing={1}>
                  {failedStage === "evaluation" && (
                    <Typography color="error" variant="body2">
                      One or more improved ideas could not be assessed.
                    </Typography>
                  )}
                  <Typography color="text.secondary">
                    {assessmentReachedCount} of {selectedIdeaCount} final
                    assessments started · {evaluatedIdeaCount} of{" "}
                    {selectedIdeaCount} complete.
                  </Typography>
                </Stack>
              </ProgressCard>
            </>
          )}
          </Stack>
        </Stack>
      )}
    </Stack>
  )
}
