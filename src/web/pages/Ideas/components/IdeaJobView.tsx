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

function IdeaCard({
  idea,
  position,
  critiqueStreamId,
  critiquePending,
}: {
  idea: IdeaJobRunState["ideas"][number]
  position: number
  critiqueStreamId: string | undefined
  critiquePending: boolean
}) {
  const headingId = `idea-${position}-title`

  return (
    <Card component="article" aria-labelledby={headingId} variant="outlined">
      <CardContent>
        <Stack spacing={2}>
          <Stack spacing={0.5}>
            <Typography component="h3" id={headingId} variant="h6">
              {idea.title}
            </Typography>
            <Typography variant="body2">{idea.description}</Typography>
          </Stack>
          {critiqueStreamId ? (
            <GenerationOutput
              announcementLabel={`Critique for ${idea.title}`}
              headingComponent="h4"
              streamId={critiqueStreamId}
              title="Critique"
              waitingText="Critiquing this idea…"
              testId={`idea-critique-${position}`}
            />
          ) : (
            <Stack spacing={0.5}>
              <Typography component="h4" variant="subtitle1">
                Critique
              </Typography>
              <Typography
                color={critiquePending ? "text.secondary" : "error"}
                variant="body2"
              >
                {critiquePending
                  ? "Critique pending…"
                  : "Critique did not start for this idea."}
              </Typography>
            </Stack>
          )}
        </Stack>
      </CardContent>
    </Card>
  )
}

export function IdeaJobView({
  prompt,
  run,
}: {
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
    failedStage === "critique"
  const failedAfterResearch =
    failedStage === "summary" ||
    failedStage === "ideas" ||
    failedStage === "critique"
  const failedAfterSummary =
    failedStage === "ideas" || failedStage === "critique"
  const failedAfterIdeas = failedStage === "critique"
  const hasIdeas = run.ideas.length > 0
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
    running:
      run.status === "running" &&
      Boolean(run.ideaGenerationStreamId) &&
      !hasIdeas,
    completed: hasIdeas || failedAfterIdeas,
  })
  return (
    <Stack spacing={3}>
      <Stack spacing={0.5}>
        <Typography component="h1" variant="h4">
          Ideas
        </Typography>
        <Typography component="p" variant="h6" sx={{ overflowWrap: "anywhere" }}>
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
          {run.ideas.map((idea, position) => {
            // Ideas are immutable and replayed in durable generation order.
            // eslint-disable-next-line @eslint-react/no-array-index-key
            return (
              <IdeaCard
                critiquePending={run.status === "running"}
                critiqueStreamId={run.critiqueGenerationStreamIds[position]}
                idea={idea}
                key={position}
                position={position}
              />
            )
          })}
        </Stack>
      </ProgressCard>
    </Stack>
  )
}
