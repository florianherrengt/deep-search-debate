import {
  Alert,
  Card,
  CardContent,
  CircularProgress,
  Stack,
  Typography,
} from "@mui/material"
import { GenerationOutput } from "../../../components/streaming/GenerationOutput.tsx"
import type { IdeaJobRunState } from "../ideaJobState.ts"
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
  title,
  prompt,
  run,
}: {
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
    failedStage === "ideas"
  const failedAfterResearch =
    failedStage === "summary" || failedStage === "ideas"
  const failedAfterSummary = failedStage === "ideas"
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
    failed: failedStage === "ideas",
    running: run.status === "running" && Boolean(run.ideaGenerationStreamId),
    completed: run.status === "completed",
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
          {ideaStatus === "running" && (
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
          {ideaStatus === "failed" && (
            <Typography color="error" variant="body2">
              Idea generation stopped before producing a complete set.
            </Typography>
          )}
          {ideaStatus === "completed" && run.ideas.length === 0 && (
            <Typography color="text.secondary">
              No ideas were returned.
            </Typography>
          )}
          {run.ideas.map((idea) => (
            <Card key={`${idea.title}-${idea.description}`} variant="outlined">
              <CardContent>
                <Typography component="h3" variant="h6" gutterBottom>
                  {idea.title}
                </Typography>
                <Typography variant="body2">{idea.description}</Typography>
              </CardContent>
            </Card>
          ))}
        </Stack>
      </ProgressCard>
    </Stack>
  )
}
