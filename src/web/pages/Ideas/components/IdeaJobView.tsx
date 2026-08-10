import {
  Alert,
  Button,
  Card,
  CardContent,
  Chip,
  CircularProgress,
  Stack,
  Typography,
} from "@mui/material"
import { alpha } from "@mui/material/styles"
import { Link } from "react-router-dom"
import { GenerationOutput } from "../../../components/streaming/GenerationOutput.tsx"
import { useDeepSearchJob } from "../../../lib/useDeepSearchJob.ts"
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

function InlineIdeaResearch({
  research,
}: {
  research: IdeaJobRunState["refinedIdeaResearch"][string]
}) {
  const run = useDeepSearchJob(research.deepSearchJobId)

  return (
    <Stack spacing={1.5}>
      <Stack
        direction={{ xs: "column", sm: "row" }}
        spacing={1}
        sx={{ alignItems: { sm: "center" }, justifyContent: "space-between" }}
      >
        <Typography component="h4" variant="subtitle1">
          Idea-specific research
        </Typography>
        <Button
          component={Link}
          size="small"
          target="_blank"
          rel="noopener noreferrer"
          to={`/deep-search/${research.slug}`}
          variant="text"
        >
          Open full research
        </Button>
      </Stack>
      {run.error && <Alert severity="error">{run.error}</Alert>}
      {run.subscriptionError && !run.error && (
        <Alert severity="warning">{run.subscriptionError}</Alert>
      )}
      {run.finalAnswerStreamId ? (
        <GenerationOutput
          announcementLabel={`Research for ${research.title}`}
          format="markdown"
          headingComponent="h4"
          streamId={run.finalAnswerStreamId}
          title="Research findings"
          waitingText="Writing the research findings…"
          testId={`idea-research-${research.deepSearchJobId}`}
        />
      ) : (
        !run.error && (
          <Stack
            aria-live="polite"
            direction="row"
            role="status"
            spacing={1}
            sx={{ alignItems: "center" }}
          >
            <CircularProgress aria-hidden="true" size={18} />
            <Typography color="text.secondary" variant="body2">
              Researching this improved idea…
            </Typography>
          </Stack>
        )
      )}
    </Stack>
  )
}

function RefinedIdeaCard({
  idea,
  refinedIdea,
  refinementStarted,
  research,
}: {
  idea: IdeaJobRunState["ideas"][number]
  refinedIdea: IdeaJobRunState["refinedIdeas"][string] | undefined
  refinementStarted: boolean
  research: IdeaJobRunState["refinedIdeaResearch"][string] | undefined
}) {
  const headingId = `refined-${idea.ideaId}-title`

  return (
    <Card component="article" aria-labelledby={headingId} variant="outlined">
      <CardContent>
        <Stack spacing={2}>
          <Typography component="h3" id={headingId} variant="h6">
            {refinedIdea?.title ?? idea.title}
          </Typography>

          <Stack spacing={0.5}>
            <Typography component="h4" variant="subtitle1">
              Original idea
            </Typography>
            <Typography variant="body2">{idea.title}</Typography>
            <Typography color="text.secondary" variant="body2">
              {idea.description}
            </Typography>
          </Stack>

          {refinedIdea ? (
            <Stack spacing={0.5}>
              <Typography component="h4" variant="subtitle1">
                Improved idea
              </Typography>
              <Typography variant="body2">{refinedIdea.title}</Typography>
              <Typography color="text.secondary" variant="body2">
                {refinedIdea.description}
              </Typography>
            </Stack>
          ) : (
            <Stack
              aria-live="polite"
              direction="row"
              role="status"
              spacing={1}
              sx={{ alignItems: "center" }}
            >
              {refinementStarted && (
                <CircularProgress aria-hidden="true" size={18} />
              )}
              <Typography color="text.secondary" variant="body2">
                {refinementStarted
                  ? "Improving this selected idea…"
                  : "Waiting to improve this selected idea…"}
              </Typography>
            </Stack>
          )}

          {research && <InlineIdeaResearch research={research} />}
        </Stack>
      </CardContent>
    </Card>
  )
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
  const isSelected = idea.selection === "selected"
  const selectionLabel =
    idea.selection === "pending"
      ? "Awaiting selection"
      : isSelected
        ? "Selected idea"
        : "Not selected"

  return (
    <Card
      component="article"
      aria-labelledby={headingId}
      data-selected={isSelected ? "true" : undefined}
      data-selection-status={idea.selection}
      variant="outlined"
      sx={(theme) => ({
        borderColor: isSelected
          ? alpha(theme.palette.primary.main, 0.55)
          : undefined,
        backgroundColor: isSelected
          ? alpha(theme.palette.primary.main, 0.035)
          : undefined,
      })}
    >
      <CardContent>
        <Stack spacing={2}>
          <Stack spacing={0.75}>
            <Stack
              direction={{ xs: "column", sm: "row" }}
              spacing={1}
              sx={{
                alignItems: { sm: "flex-start" },
                justifyContent: "space-between",
              }}
            >
              <Typography component="h3" id={headingId} variant="h6">
                {idea.title}
              </Typography>
              <Chip
                color={isSelected ? "primary" : "default"}
                label={selectionLabel}
                size="small"
                variant="outlined"
              />
            </Stack>
            <Typography variant="body2">{idea.description}</Typography>
          </Stack>
          {critiqueStreamId ? (
            <GenerationOutput
              announcementLabel={`Critique for ${idea.title}`}
              format="markdown"
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
  const failedAfterIdeas =
    failedStage === "critique" ||
    failedStage === "selection" ||
    failedStage === "refinement" ||
    failedStage === "idea-research"
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
    failed: failedStage === "ideas",
    running:
      run.status === "running" &&
      Boolean(run.ideaGenerationStreamId) &&
      !hasIdeas,
    completed: hasIdeas || failedAfterIdeas,
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
            return (
              <IdeaCard
                key={idea.ideaId}
                critiquePending={run.status === "running"}
                critiqueStreamId={run.critiqueGenerationStreamIds[position]}
                idea={idea}
                position={position}
              />
            )
          })}
        </Stack>
      </ProgressCard>

      <ProgressCard
        autoExpandStatuses={["running", "completed", "failed"]}
        title="Select ideas"
        status={selectionStatus}
      >
        <Stack spacing={2}>
          {run.ideaSelectionStreamId && (
            <GenerationOutput
              announcementLabel="Idea selection"
              format="structured-list"
              headingComponent="h3"
              streamId={run.ideaSelectionStreamId}
              title="Idea selection"
              waitingText="Selecting ideas…"
              testId="idea-selection"
            />
          )}
          {selectionStatus === "waiting" && (
            <Typography color="text.secondary" variant="body2">
              Selection starts after every critique completes.
            </Typography>
          )}
          {selectionStatus === "failed" && !run.ideaSelectionStreamId && (
            <Typography color="error" variant="body2">
              Idea selection stopped before its model stream started.
            </Typography>
          )}
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
          {selectedIdeas.map((idea) => (
            <RefinedIdeaCard
              key={idea.ideaId}
              idea={idea}
              refinedIdea={run.refinedIdeas[idea.ideaId]}
              refinementStarted={Boolean(
                run.refinementGenerationStreamIds[idea.ideaId],
              )}
              research={run.refinedIdeaResearch[idea.ideaId]}
            />
          ))}
        </Stack>
      </ProgressCard>
    </Stack>
  )
}
