import Alert from "@mui/material/Alert"
import CircularProgress from "@mui/material/CircularProgress"
import Stack from "@mui/material/Stack"
import Typography from "@mui/material/Typography"
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
  running,
  completed,
}: {
  failed: boolean
  running: boolean
  completed: boolean
}): ProgressStatus {
  if (failed) return "failed"
  if (running) return "running"
  if (completed) return "completed"
  return "waiting"
}

export function IdeaJobView({
  jobSlug,
  title,
  prompt,
  run,
}: {
  jobSlug: string
  title: string
  prompt: string
  run: IdeaJobRunState & { subscriptionError?: string | null }
}) {
  // Stream boundaries normally mark prior stages complete. An explicit failed
  // stage also proves that every preceding stage completed, including failures
  // that happen before the failing stage creates its first stream.
  const failedStage = run.failedStage
  const failedAfterPlanning =
    failedStage === "research" ||
    failedStage === "summary" ||
    failedStage === "ideas" ||
    failedStage === "critique" ||
    failedStage === "selection" ||
    failedStage === "refinement" ||
    failedStage === "idea-research"
  const failedAfterResearch =
    failedStage === "summary" ||
    failedStage === "ideas" ||
    failedStage === "critique" ||
    failedStage === "selection" ||
    failedStage === "refinement" ||
    failedStage === "idea-research"
  const failedAfterSummary =
    failedStage === "ideas" ||
    failedStage === "critique" ||
    failedStage === "selection" ||
    failedStage === "refinement" ||
    failedStage === "idea-research"
  const failedAfterSelection =
    failedStage === "refinement" || failedStage === "idea-research"
  const hasIdeas = run.ideas.length > 0
  const selectionCompleted =
    hasIdeas && run.ideas.every(({ selection }) => selection !== "pending")
  const selectedIdeaCount = run.ideas.filter(
    ({ selection }) => selection === "selected",
  ).length
  const selectedIdeas = run.ideas.filter(
    ({ selection }) => selection === "selected",
  )
  const refinementAndResearchStatus = getProgressStatus({
    failed:
      failedStage === "refinement" || failedStage === "idea-research",
    running:
      run.status === "running" &&
      selectionCompleted &&
      selectedIdeas.length > 0,
    completed:
      run.status === "completed" &&
      selectedIdeas.length > 0 &&
      selectedIdeas.every(
        ({ ideaId }) =>
          Boolean(run.refinedIdeas[ideaId]) &&
          Boolean(run.refinedIdeaResearch[ideaId]),
      ),
  })
  const planningStatus = getProgressStatus({
    failed: failedStage === "planning",
    running: run.status === "running" && run.research.length === 0,
    completed: Boolean(run.researchPromptStreamId) || failedAfterPlanning,
  })
  const researchStatus = getProgressStatus({
    failed: failedStage === "research",
    running:
      run.status === "running" &&
      run.research.length > 0 &&
      !run.researchSummaryStreamId,
    completed: Boolean(run.researchSummaryStreamId) || failedAfterResearch,
  })
  const summaryStatus = getProgressStatus({
    failed: failedStage === "summary",
    running:
      run.status === "running" &&
      Boolean(run.researchSummaryStreamId) &&
      !run.ideaGenerationStreamId,
    completed: Boolean(run.ideaGenerationStreamId) || failedAfterSummary,
  })
  const ideaStatus = getProgressStatus({
    failed:
      failedStage === "ideas" ||
      failedStage === "critique" ||
      failedStage === "selection",
    running:
      run.status === "running" &&
      Boolean(run.ideaGenerationStreamId) &&
      !selectionCompleted,
    completed:
      selectionCompleted ||
      failedAfterSelection ||
      (run.status === "completed" && Boolean(run.ideaGenerationStreamId)),
  })
  const selectionStatus = getProgressStatus({
    failed: failedStage === "selection",
    running:
      run.status === "running" &&
      Boolean(run.ideaSelectionStreamId) &&
      !selectionCompleted,
    completed: selectionCompleted,
  })
  return (
    <Stack spacing={3}>
      <Stack spacing={0.5}>
        <Typography component="h1" variant="h4">
          {title}
        </Typography>
        <Typography color="text.secondary" sx={{ maxWidth: "85ch", overflowWrap: "anywhere" }}>
          {prompt}
        </Typography>
      </Stack>
      {run.error && <Alert severity="error">{run.error}</Alert>}
      {run.subscriptionError && !run.error && (
        <Alert severity="warning">{run.subscriptionError}</Alert>
      )}

      <ProgressCard
        title="Plan the research"
        status={planningStatus}
      >
        {run.researchPromptStreamId && (
          <GenerationOutput
            format="structured-list"
            headingComponent="h3"
            streamId={run.researchPromptStreamId}
            title="Research prompts"
            waitingText="Planning research…"
            testId="idea-research-prompts"
          />
        )}
      </ProgressCard>

      <ProgressCard
        title="Deep research"
        status={researchStatus}
      >
        <ResearchProgress research={run.research} />
      </ProgressCard>

      <ProgressCard
        title="Summarise the research"
        status={summaryStatus}
      >
        {run.researchSummaryStreamId && (
          <GenerationOutput
            format="markdown"
            headingComponent="h3"
            streamId={run.researchSummaryStreamId}
            title="Research briefing"
            waitingText="Summarising research…"
            testId="idea-research-summary"
          />
        )}
      </ProgressCard>

      <ProgressCard
        autoExpandStatuses={["running", "completed", "failed"]}
        title="Generate ideas"
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
          {failedStage === "critique" && (
            <Typography color="error" variant="body2">
              Idea critique did not complete.
            </Typography>
          )}
          {selectionStatus === "waiting" &&
            hasIdeas &&
            run.status === "running" && (
              <Stack
                aria-live="polite"
                direction="row"
                role="status"
                spacing={1}
                sx={{ alignItems: "center" }}
              >
                <CircularProgress aria-hidden="true" size={20} />
                <Typography color="text.secondary">
                  Critiquing ideas… Selection starts when every critique is ready.
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
              <Typography color="text.secondary">Selecting ideas…</Typography>
            </Stack>
          )}
          {selectionStatus === "failed" && (
            <Typography color="error" variant="body2">
              Idea selection did not complete.
            </Typography>
          )}
          {run.ideaSelectionStreamId && (
            <GenerationOutput
              announcementLabel="Idea selection"
              headingComponent="h3"
              showText={false}
              streamId={run.ideaSelectionStreamId}
              title="Selection reasoning"
              waitingText="Selecting ideas…"
              testId="idea-selection"
            />
          )}
          {ideaStatus === "completed" && run.ideas.length === 0 && (
            <Typography color="text.secondary">
              No ideas were returned.
            </Typography>
          )}
          {run.ideas.length > 0 && <IdeaList jobSlug={jobSlug} run={run} />}
          {selectionCompleted && (
            <Typography color="text.secondary" variant="body2">
              {selectedIdeaCount}
              {selectedIdeaCount === 1 ? " idea selected." : " ideas selected."}
            </Typography>
          )}
        </Stack>
      </ProgressCard>

      <ProgressCard
        autoExpandStatuses={["running", "completed", "failed"]}
        title="Improve and research selected ideas"
        status={refinementAndResearchStatus}
      >
        <Stack spacing={2}>
          {refinementAndResearchStatus === "waiting" && (
            <Typography color="text.secondary" variant="body2">
              Improvement starts after idea selection completes.
            </Typography>
          )}
          {refinementAndResearchStatus !== "waiting" && (
            <Typography color="text.secondary" variant="body2">
              Improvement and research progress is shown on the ideas above.
            </Typography>
          )}
        </Stack>
      </ProgressCard>
    </Stack>
  )
}
