import {
  ArrowBackRounded,
  ArrowForwardRounded,
  NavigateBeforeRounded,
} from "@mui/icons-material"
import {
  Button,
  Chip,
  Link as MuiLink,
  Stack,
  Typography,
} from "@mui/material"
import { Link } from "react-router-dom"
import { ExternalLink } from "../../../components/ExternalLink.tsx"
import {
  debateStageLabels,
  getDebateStatusPresentation,
} from "../debatePresentation.ts"
import { getAdjacentMatches } from "../debateSelectors.ts"
import type { DebateMatch, DebateTournament } from "../debateUiTypes.ts"
import { DebateStoppedAlert } from "./DebateStoppedAlert.tsx"
import { DebateTranscript } from "./DebateTranscript.tsx"

export type DebateMatchDetailProps = {
  match: DebateMatch
  tournament: DebateTournament
}

function matchName(match: DebateMatch): string {
  return `${match.firstIdea.title} versus ${match.secondIdea.title}`
}

function matchPath(tournament: DebateTournament, match: DebateMatch): string {
  return `/debates/${encodeURIComponent(tournament.slug)}/matches/${encodeURIComponent(match.debateMatchId)}`
}

export function DebateMatchDetail({
  match,
  tournament,
}: DebateMatchDetailProps) {
  const { previous, next } = getAdjacentMatches(
    tournament,
    match.debateMatchId,
  )
  const round = tournament.rounds.find((candidate) =>
    candidate.matches.some(
      (candidateMatch) =>
        candidateMatch.debateMatchId === match.debateMatchId,
    ),
  )
  const debatePath = `/debates/${encodeURIComponent(tournament.slug)}`
  const live =
    tournament.status === "running" &&
    !tournament.stopRequested &&
    match.status === "running"
  const roundLabel =
    round?.stage === "swiss"
      ? `Round ${round.stageRoundNumber}`
      : round
        ? debateStageLabels[round.stage]
        : "Debate match"
  const matchStatus =
    match.status === "completed"
      ? { label: "Decision made", color: "success" as const }
      : live
        ? { label: "Live now", color: "primary" as const }
        : tournament.status === "running" && !tournament.stopRequested
          ? { label: "Not started", color: "default" as const }
          : tournament.status === "completed"
            ? { label: "Stopped", color: "default" as const }
            : getDebateStatusPresentation(
                tournament.status,
                tournament.stopRequested,
              )

  return (
    <Stack spacing={3}>
      <Stack
        direction="row"
        spacing={1}
        useFlexGap
        sx={{ alignItems: "center", flexWrap: "wrap" }}
      >
        <Button
          component={Link}
          startIcon={<ArrowBackRounded />}
          to={debatePath}
        >
          Back to debate
        </Button>
        <Stack
          direction="row"
          spacing={1}
          sx={{ alignItems: "center", flexWrap: "wrap", ml: "auto" }}
        >
          {previous ? (
            <Button
              aria-label={`Previous: ${matchName(previous)}`}
              component={Link}
              startIcon={<NavigateBeforeRounded />}
              sx={{
                maxInlineSize: 280,
                minInlineSize: 0,
                overflowWrap: "anywhere",
                textAlign: "left",
              }}
              to={matchPath(tournament, previous)}
              variant="outlined"
            >
              {matchName(previous)}
            </Button>
          ) : null}
          {next ? (
            <Button
              aria-label={`Next: ${matchName(next)}`}
              component={Link}
              endIcon={<ArrowForwardRounded />}
              sx={{
                maxInlineSize: 280,
                minInlineSize: 0,
                overflowWrap: "anywhere",
                textAlign: "left",
              }}
              to={matchPath(tournament, next)}
              variant="outlined"
            >
              {matchName(next)}
            </Button>
          ) : null}
        </Stack>
      </Stack>

      <Stack spacing={1}>
        <Typography color="text.secondary" variant="overline">
          {roundLabel}
        </Typography>
        <Stack
          direction={{ xs: "column", sm: "row" }}
          spacing={1}
          sx={{ alignItems: { sm: "center" } }}
        >
          <Typography component="h1" sx={{ flexGrow: 1 }} variant="h4">
            <MuiLink
              color="inherit"
              component={Link}
              sx={{ overflowWrap: "anywhere" }}
              to={`/ideas/${encodeURIComponent(tournament.slug)}`}
            >
              {match.firstIdea.title} vs {match.secondIdea.title}
            </MuiLink>
          </Typography>
          <Chip
            color={matchStatus.color}
            label={matchStatus.label}
            size="small"
            sx={{ alignSelf: "flex-start" }}
            variant={live ? "filled" : "outlined"}
          />
        </Stack>
        <Typography color="text.secondary" variant="body2">
          From {tournament.title}
        </Typography>
        <Stack
          direction={{ xs: "column", sm: "row" }}
          spacing={1}
          sx={{ alignItems: "flex-start" }}
        >
          {[match.firstIdea, match.secondIdea].map((idea) => (
            <ExternalLink
              key={idea.ideaId}
              size="small"
              sx={{ overflowWrap: "anywhere", textAlign: "left" }}
              to={`/ideas/${encodeURIComponent(tournament.slug)}/${encodeURIComponent(idea.ideaId)}#improved-idea`}
              variant="button"
            >
              {idea.title}
            </ExternalLink>
          ))}
        </Stack>
      </Stack>

      {tournament.error && (
        <DebateStoppedAlert
          status={tournament.status === "failed" ? "failed" : "interrupted"}
          userStopped={tournament.stopRequested}
        />
      )}

      <DebateTranscript live={live} match={match} />
    </Stack>
  )
}
