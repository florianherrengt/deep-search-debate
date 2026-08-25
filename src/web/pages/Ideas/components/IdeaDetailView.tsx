import ArrowBack from "@mui/icons-material/ArrowBack"
import Alert from "@mui/material/Alert"
import AlertTitle from "@mui/material/AlertTitle"
import Button from "@mui/material/Button"
import Card from "@mui/material/Card"
import CardContent from "@mui/material/CardContent"
import Chip from "@mui/material/Chip"
import CircularProgress from "@mui/material/CircularProgress"
import Stack from "@mui/material/Stack"
import Typography from "@mui/material/Typography"
import { useEffect } from "react"
import { Link, useLocation } from "react-router-dom"
import { ExternalLink } from "../../../components/ExternalLink.tsx"
import {
  getIdeaPresentation,
  hasRefinedIdeaResearchCompleted,
  type IdeaJobRunState,
  type IdeaResearchState,
} from "../ideaJobState.ts"
import { IdeaAssessment } from "./IdeaAssessment.tsx"

function WaitingStatus({ children }: { children: string }) {
  return (
    <Stack
      aria-live="polite"
      direction="row"
      role="status"
      spacing={1}
      sx={{ alignItems: "center" }}
    >
      <CircularProgress aria-hidden="true" size={18} />
      <Typography color="text.secondary" variant="body2">
        {children}
      </Typography>
    </Stack>
  )
}

function IdeaResearch({
  available,
  running,
  research,
}: {
  available: boolean
  running: boolean
  research: IdeaResearchState
}) {
  return (
    <Card component="section" variant="outlined">
      <CardContent>
        <Stack spacing={1.5}>
          <Stack
            direction={{ xs: "column", sm: "row" }}
            spacing={1}
            sx={{ alignItems: { sm: "center" }, justifyContent: "space-between" }}
          >
            <Typography component="h2" variant="h6">
              Supporting research
            </Typography>
            <ExternalLink
              buttonVariant="text"
              size="small"
              to={`/deep-search/${encodeURIComponent(research.slug)}`}
              variant="button"
            >
              Open full research
            </ExternalLink>
          </Stack>
          {available ? (
            <Typography color="text.secondary" variant="body2">
              Supporting research is complete and available for this improved
              idea.
            </Typography>
          ) : running ? (
            <WaitingStatus>
              Supporting research is in progress for this draft…
            </WaitingStatus>
          ) : (
            <Typography color="text.secondary" variant="body2">
              The workflow ended during supporting research. Open this idea's
              research page for its final status.
            </Typography>
          )}
        </Stack>
      </CardContent>
    </Card>
  )
}

function IdeaUnavailable({
  jobSlug,
  terminal,
}: {
  jobSlug: string
  terminal: boolean
}) {
  return (
    <Stack spacing={2}>
      <Button
        component={Link}
        startIcon={<ArrowBack />}
        sx={{ alignSelf: "flex-start" }}
        to={`/ideas/${encodeURIComponent(jobSlug)}`}
      >
        Back to ideas
      </Button>
      <Typography component="h1" variant="h4">
        {terminal ? "Idea not found" : "Loading idea…"}
      </Typography>
      {terminal ? (
        <Alert severity="error">
          This idea does not exist in this run or is no longer available.
        </Alert>
      ) : (
        <WaitingStatus>Loading this idea and its progress…</WaitingStatus>
      )}
    </Stack>
  )
}

export function IdeaDetailView({
  ideaId,
  jobSlug,
  jobTitle,
  numberOfIdeas,
  run,
  stopRequested = false,
}: {
  ideaId: string
  jobSlug: string
  jobTitle: string
  numberOfIdeas: number
  run: IdeaJobRunState & { subscriptionError?: string | null }
  stopRequested?: boolean
}) {
  const status =
    stopRequested && run.status === "running" ? "stopping" : run.status
  const location = useLocation()
  const position = run.ideas.findIndex((idea) => idea.ideaId === ideaId)
  const idea = run.ideas[position]
  const refinedIdea = idea ? run.refinedIdeas[idea.ideaId] : undefined
  const presentationRun: IdeaJobRunState =
    status === run.status ? run : { ...run, status }
  const presentation = idea
    ? getIdeaPresentation(idea, presentationRun)
    : undefined

  useEffect(() => {
    if (
      location.hash !== "#improved-idea" ||
      !refinedIdea ||
      !presentation?.isFinal
    ) {
      return
    }

    const heading = document.getElementById("improved-idea")
    if (!heading) return
    heading.tabIndex = -1
    heading.scrollIntoView({ block: "start" })
    heading.focus({ preventScroll: true })
  }, [location.hash, presentation?.isFinal, refinedIdea])

  if (!idea || !presentation) {
    return (
      <IdeaUnavailable
        jobSlug={jobSlug}
        terminal={
          run.ideas.length >= numberOfIdeas ||
          status === "completed" ||
          status === "failed" ||
          status === "stopping" ||
          status === "interrupted"
        }
      />
    )
  }

  const evaluation = run.ideaEvaluations[idea.ideaId]
  const research = run.refinedIdeaResearch[idea.ideaId]
  const evaluationStarted =
    run.ideaEvaluationStreamIds?.[idea.ideaId] !== undefined
  const refinedResearchCompleted = hasRefinedIdeaResearchCompleted(run)
  const researchAvailable = refinedResearchCompleted

  return (
    <Stack spacing={3}>
      <Button
        component={Link}
        startIcon={<ArrowBack />}
        sx={{ alignSelf: "flex-start" }}
        to={`/ideas/${encodeURIComponent(jobSlug)}`}
      >
        Back to ideas
      </Button>

      <Stack spacing={0.75}>
        <Typography color="text.secondary" variant="body2">
          {jobTitle}
        </Typography>
        <Stack
          direction={{ xs: "column", sm: "row" }}
          spacing={1}
          sx={{ alignItems: { sm: "center" }, justifyContent: "space-between" }}
        >
          <Typography component="h1" variant="h4">
            {presentation.displayIdea.title}
          </Typography>
          <Chip
            color={presentation.color}
            label={presentation.label}
            variant="outlined"
          />
        </Stack>
      </Stack>

      {run.error && (
        <Alert severity={status === "interrupted" ? "info" : "error"}>
          {status === "interrupted" && (
            <AlertTitle>{stopRequested ? "Stopped" : "Interrupted"}</AlertTitle>
          )}
          {run.error}
        </Alert>
      )}
      {run.subscriptionError && !run.error && (
        <Alert severity="warning">{run.subscriptionError}</Alert>
      )}

      {idea.selection === "selected" && (
        <Card component="section" variant="outlined">
          <CardContent>
            <Stack spacing={1}>
              <Typography component="h2" id="improved-idea" variant="h6">
                {presentation.isFinal ? "Improved idea" : "Improved idea draft"}
              </Typography>
              {refinedIdea ? (
                <Stack spacing={1}>
                  <Typography color="text.secondary">
                    {refinedIdea.description}
                  </Typography>
                  {presentation.isProvisional && (
                    <Typography color="text.secondary" variant="body2">
                      This is a provisional draft until its supporting research
                      and final assessment are complete.
                    </Typography>
                  )}
                </Stack>
              ) : status === "running" ? (
                <WaitingStatus>
                  {run.refinementGenerationStreamIds[idea.ideaId]
                    ? "Improving this idea…"
                    : "Waiting to improve this idea…"}
                </WaitingStatus>
              ) : (
                <Typography color="error" variant="body2">
                  Improvement did not complete for this idea.
                </Typography>
              )}
            </Stack>
          </CardContent>
        </Card>
      )}

      {idea.selection !== "selected" && (
        <Card component="section" variant="outlined">
          <CardContent>
            <Stack spacing={1}>
              <Typography component="h2" variant="h6">
                Original idea
              </Typography>
              <Typography color="text.secondary">{idea.description}</Typography>
            </Stack>
          </CardContent>
        </Card>
      )}

      {idea.selection === "selected" &&
        (research ? (
          <IdeaResearch
            available={researchAvailable}
            research={research}
            running={status === "running"}
          />
        ) : (
          <Card component="section" variant="outlined">
            <CardContent>
              <Stack spacing={1}>
                <Typography component="h2" variant="h6">
                  Supporting research
                </Typography>
                {status === "running" ? (
                  <WaitingStatus>
                    Research starts after the improved idea is ready…
                  </WaitingStatus>
                ) : (
                  <Typography color="error" variant="body2">
                    Supporting research did not start for this idea.
                  </Typography>
                )}
              </Stack>
            </CardContent>
          </Card>
        ))}

      {idea.selection === "selected" &&
        (evaluation ? (
          <IdeaAssessment evaluation={evaluation} position={position} />
        ) : (
          <Card component="section" variant="outlined">
            <CardContent>
              <Stack spacing={1}>
                <Typography component="h2" variant="h6">
                  Assessment of improved idea
                </Typography>
                {status === "running" && evaluationStarted ? (
                  <WaitingStatus>Assessing this improved idea…</WaitingStatus>
                ) : status === "running" && refinedResearchCompleted ? (
                  <WaitingStatus>
                    Waiting for this improved idea's assessment to start…
                  </WaitingStatus>
                ) : status === "running" ? (
                  <WaitingStatus>
                    Assessment starts after supporting research completes…
                  </WaitingStatus>
                ) : (
                  <Typography color="error" variant="body2">
                    Assessment did not complete for this improved idea.
                  </Typography>
                )}
              </Stack>
            </CardContent>
          </Card>
        ))}

      {idea.selection === "selected" && (
        <Card component="section" variant="outlined">
          <CardContent>
            <Stack spacing={1}>
              <Typography component="h2" variant="h6">
                Original candidate
              </Typography>
              <Typography component="h3" variant="subtitle1">
                {idea.title}
              </Typography>
              <Typography color="text.secondary">
                {idea.description}
              </Typography>
            </Stack>
          </CardContent>
        </Card>
      )}

      <Stack component="section" spacing={1}>
        <Typography component="h2" variant="h6">
          Decision
        </Typography>
        {idea.selection === "pending" && status === "running" ? (
          <WaitingStatus>Comparing this candidate with the others…</WaitingStatus>
        ) : idea.selection === "pending" ? (
          <Typography color="error" variant="body2">
            Selection did not complete for this idea.
          </Typography>
        ) : (
          <Typography color="text.secondary">
            {idea.selection === "selected"
              ? "This candidate was selected for improvement, deeper research, and final assessment."
              : "This candidate was not selected for further improvement or research."}
          </Typography>
        )}
      </Stack>
    </Stack>
  )
}
