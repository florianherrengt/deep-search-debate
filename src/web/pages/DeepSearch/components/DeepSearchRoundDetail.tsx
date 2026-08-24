import ArrowBackRounded from "@mui/icons-material/ArrowBackRounded"
import ArrowForwardRounded from "@mui/icons-material/ArrowForwardRounded"
import Alert from "@mui/material/Alert"
import AlertTitle from "@mui/material/AlertTitle"
import Button from "@mui/material/Button"
import Chip from "@mui/material/Chip"
import CircularProgress from "@mui/material/CircularProgress"
import Stack from "@mui/material/Stack"
import Typography from "@mui/material/Typography"
import { Link } from "react-router-dom"

import { GenerationOutput } from "../../../components/streaming/GenerationOutput.tsx"
import type { DeepSearchRunState } from "../../../lib/deepSearchState.ts"
import {
  getDeepSearchRoundNumbers,
  getDeepSearchRoundStatus,
} from "../deepSearchPresentation.ts"
import { RoundReview } from "./RoundReview.tsx"
import { SearchResults } from "./SearchResults.tsx"
import { MarkdownText } from "../../../components/MarkdownText.tsx"

export type DeepSearchRoundDetailProps = {
  jobSlug: string
  jobTitle: string
  maxRounds: number
  researchRequest: string
  /** One-based round number read from the route. */
  roundNumber: number
  run: DeepSearchRunState
  stopRequested?: boolean
}

function isValidRoundNumber(roundNumber: number, maxRounds: number): boolean {
  return (
    Number.isSafeInteger(maxRounds) &&
    maxRounds > 0 &&
    Number.isSafeInteger(roundNumber) &&
    roundNumber >= 1 &&
    roundNumber <= maxRounds
  )
}

function roundPath(jobSlug: string, roundNumber: number): string {
  return `/deep-search/${encodeURIComponent(jobSlug)}/rounds/${roundNumber}`
}

function getRoundSummary({
  answerStreamId,
  review,
  status,
}: {
  answerStreamId?: string
  review: DeepSearchRunState["roundReviews"][number] | undefined
  status: ReturnType<typeof getDeepSearchRoundStatus>
}): string {
  if (status === "stopped") {
    return "Research stopped before this round could finish. Any available work is shown below."
  }
  if (review?.status === "running") {
    return "Reviewing whether more research is needed…"
  }
  if (status === "complete") {
    return answerStreamId
      ? "The candidate answer and supporting evidence are ready."
      : "The available evidence from this round is ready."
  }
  if (answerStreamId) return "Writing the candidate answer…"
  return "Gathering sources and analysing evidence…"
}

function BackToResearch({ jobSlug }: { jobSlug: string }) {
  return (
    <Button
      component={Link}
      startIcon={<ArrowBackRounded />}
      sx={{ alignSelf: "flex-start" }}
      to={`/deep-search/${encodeURIComponent(jobSlug)}`}
    >
      Back to research
    </Button>
  )
}

function RoundNavigation({
  jobSlug,
  nextRound,
  previousRound,
}: {
  jobSlug: string
  nextRound?: number
  previousRound?: number
}) {
  if (previousRound === undefined && nextRound === undefined) return null

  return (
    <Stack
      aria-label="Research round navigation"
      component="nav"
      direction="row"
      spacing={1}
      sx={{ alignItems: "center", justifyContent: "space-between" }}
    >
      {previousRound === undefined ? null : (
        <Button
          aria-label={`Previous round: Round ${previousRound}`}
          component={Link}
          startIcon={<ArrowBackRounded />}
          to={roundPath(jobSlug, previousRound)}
        >
          Previous round
        </Button>
      )}
      {nextRound === undefined ? null : (
        <Button
          aria-label={`Next round: Round ${nextRound}`}
          component={Link}
          endIcon={<ArrowForwardRounded />}
          sx={{ ml: "auto" }}
          to={roundPath(jobSlug, nextRound)}
        >
          Next round
        </Button>
      )}
    </Stack>
  )
}

/** Presents one durable research round without nesting it in a round accordion. */
export function DeepSearchRoundDetail({
  jobSlug,
  jobTitle,
  maxRounds,
  researchRequest,
  roundNumber,
  run,
  stopRequested = false,
}: DeepSearchRoundDetailProps) {
  const presentationRun: DeepSearchRunState =
    stopRequested && run.status === "running"
      ? { ...run, status: "stopping" }
      : run
  const validRoundNumber = isValidRoundNumber(roundNumber, maxRounds)
  const roundIndex = roundNumber - 1
  const roundIndexes = getDeepSearchRoundNumbers(presentationRun)
  const roundExists = validRoundNumber && roundIndexes.includes(roundIndex)
  const terminal =
    presentationRun.status === "completed" ||
    presentationRun.status === "failed" ||
    presentationRun.status === "stopping" ||
    presentationRun.status === "interrupted"

  if (!validRoundNumber || (!roundExists && terminal)) {
    return (
      <Stack spacing={2} sx={{ alignItems: "flex-start" }}>
        <BackToResearch jobSlug={jobSlug} />
        <Typography component="h1" variant="h4">
          Round not found
        </Typography>
        <Typography color="text.secondary">
          This round does not exist in this research job.
        </Typography>
      </Stack>
    )
  }

  const previousRound = roundIndexes
    .filter((candidate) => candidate < roundIndex)
    .at(-1)
  const nextRound = roundIndexes.find((candidate) => candidate > roundIndex)
  const navigation = (
    <RoundNavigation
      jobSlug={jobSlug}
      nextRound={nextRound === undefined ? undefined : nextRound + 1}
      previousRound={
        previousRound === undefined ? undefined : previousRound + 1
      }
    />
  )

  if (!roundExists) {
    return (
      <Stack spacing={3}>
        <BackToResearch jobSlug={jobSlug} />
        <Stack spacing={1} sx={{ alignItems: "flex-start" }}>
          <Typography color="primary.main" variant="overline">
            {jobTitle}
          </Typography>
          <Typography component="h1" variant="h4">
            Round {roundNumber}
          </Typography>
          <Stack
            direction="row"
            role="status"
            spacing={1.25}
            sx={{ alignItems: "center" }}
          >
            <CircularProgress aria-label="Loading round" size={20} />
            <Typography color="text.secondary">Loading round…</Typography>
          </Stack>
        </Stack>
        {navigation}
      </Stack>
    )
  }

  const queryStreamId = presentationRun.queryGenerations.find(
    ({ round }) => round === roundIndex,
  )?.streamId
  const answerStreamId = presentationRun.roundAnswers.find(
    ({ round }) => round === roundIndex,
  )?.streamId
  const review = presentationRun.roundReviews.find(
    ({ round }) => round === roundIndex,
  )
  const searches = presentationRun.searches.filter(
    ({ round }) => round === roundIndex,
  )
  const status = getDeepSearchRoundStatus(
    presentationRun,
    roundIndex,
    roundIndexes,
  )
  const statusLabel =
    status === "complete"
      ? "Complete"
      : status === "stopped"
        ? "Stopped"
        : "In progress"

  return (
    <Stack spacing={3}>
      <BackToResearch jobSlug={jobSlug} />

      <Stack spacing={1} sx={{ alignItems: "flex-start" }}>
        <Typography color="primary.main" variant="overline">
          {jobTitle}
        </Typography>
        <Stack
          direction="row"
          spacing={1}
          useFlexGap
          sx={{ alignItems: "center", flexWrap: "wrap" }}
        >
          <Typography component="h1" variant="h4">
            Round {roundNumber}
          </Typography>
          <Chip
            color={
              status === "in-progress"
                ? "primary"
                : status === "stopped"
                  ? "error"
                  : "default"
            }
            label={statusLabel}
            size="small"
            variant="outlined"
          />
        </Stack>
        <Typography
          color="text.secondary"
          sx={{ maxWidth: "85ch", overflowWrap: "anywhere" }}
        >
          {getRoundSummary({ answerStreamId, review, status })}
        </Typography>
      </Stack>

      {run.error && presentationRun.status === "interrupted" && (
        <Alert severity="info">
          <AlertTitle>{stopRequested ? "Stopped" : "Interrupted"}</AlertTitle>
          {run.error}
        </Alert>
      )}

      <Stack
        aria-labelledby="round-research-question"
        component="section"
        spacing={0.5}
      >
        <Typography
          component="h2"
          id="round-research-question"
          variant="subtitle1"
        >
          Research question
        </Typography>
        <MarkdownText
          sx={{ maxWidth: "85ch" }}
          text={researchRequest}
        />
      </Stack>

      <Stack
        aria-labelledby="round-research-work"
        component="section"
        spacing={2}
      >
        <Typography component="h2" id="round-research-work" variant="h5">
          Round research
        </Typography>

        {queryStreamId && searches.length === 0 && (
          <GenerationOutput
            format="structured-list"
            headingComponent="h3"
            streamId={queryStreamId}
            title="Search queries"
            waitingText="Generating search queries…"
            testId={`generated-search-queries-${roundIndex}`}
          />
        )}

        <SearchResults searches={searches} />

        {answerStreamId && (
          <GenerationOutput
            format="markdown"
            headingComponent="h3"
            streamId={answerStreamId}
            title="Candidate answer"
            waitingText="Writing the current answer…"
            testId={`round-answer-${roundIndex}`}
          />
        )}

        {review && <RoundReview headingComponent="h3" review={review} />}
      </Stack>

      {navigation}
    </Stack>
  )
}
