import { AutoAwesomeRounded, LightbulbOutlined } from "@mui/icons-material"
import {
  Button,
  Card,
  CardContent,
  Chip,
  CircularProgress,
  Stack,
  Typography,
} from "@mui/material"
import type { ReactNode } from "react"
import { Link } from "react-router-dom"
import { getDebateStatusPresentation } from "../debatePresentation.ts"
import {
  getClosestAlternative,
  getWinner,
  getWinnerReason,
} from "../debateSelectors.ts"
import type { DebateTournament } from "../debateUiTypes.ts"
import { DebateStoppedAlert } from "./DebateStoppedAlert.tsx"
import { TournamentBoard } from "./TournamentBoard.tsx"
import { WinnerIdeaCard } from "./WinnerIdeaCard.tsx"

export type DebateViewProps = {
  tournament: DebateTournament
  ownerActions?: ReactNode
}

export function DebateView({ ownerActions, tournament }: DebateViewProps) {
  const winner = getWinner(tournament)
  const closestAlternative = getClosestAlternative(tournament)
  const winnerReason = getWinnerReason(tournament)
  const status = getDebateStatusPresentation(
    tournament.status,
    tournament.stopRequested,
  )
  const preparingIdeas =
    tournament.status === "running" &&
    tournament.stage === "ideas" &&
    !tournament.stopRequested

  return (
    <Stack spacing={3}>
      <Stack spacing={1}>
        <Stack
          direction={{ xs: "column", sm: "row" }}
          spacing={1}
          sx={{ alignItems: { sm: "center" } }}
        >
          <Stack direction="row" spacing={1} sx={{ alignItems: "center", flexGrow: 1 }}>
            <AutoAwesomeRounded color="primary" />
            <Typography component="h1" variant="h4">
              {tournament.title}
            </Typography>
          </Stack>
          <Stack
            direction="row"
            spacing={1}
            sx={{ alignItems: "center", alignSelf: "flex-start" }}
          >
            <Chip
              color={status.color}
              label={status.label}
              size="small"
              sx={{ height: 30 }}
              variant="outlined"
            />
            {ownerActions}
          </Stack>
        </Stack>
        <Typography
          color="text.secondary"
          sx={{ maxWidth: "85ch", overflowWrap: "anywhere" }}
          variant="body1"
        >
          {tournament.prompt}
        </Typography>
        <Button
          component={Link}
          startIcon={<LightbulbOutlined />}
          sx={{ alignSelf: "flex-start" }}
          to={`/ideas/${tournament.slug}`}
        >
          View the underlying idea generation
        </Button>
      </Stack>

      {tournament.error && (
        <DebateStoppedAlert
          status={tournament.status === "failed" ? "failed" : "interrupted"}
          userStopped={tournament.stopRequested}
        />
      )}
      {preparingIdeas && (
        <Card component="section" role="status" variant="outlined">
          <CardContent>
            <Stack
              direction="row"
              spacing={2}
              sx={{ alignItems: "flex-start" }}
            >
              <CircularProgress aria-hidden="true" size={24} sx={{ mt: 0.25 }} />
              <Stack spacing={0.5}>
                <Typography component="h2" variant="h6">
                  Generating and improving debate ideas…
                </Typography>
                <Typography color="text.secondary" variant="body2">
                  Research and idea preparation are still running. The debate
                  rounds will start automatically when the candidates are ready.
                </Typography>
              </Stack>
            </Stack>
          </CardContent>
        </Card>
      )}
      {winner && (
        <WinnerIdeaCard
          closestAlternative={closestAlternative}
          idea={winner}
          ideaJobSlug={tournament.slug}
          reason={winnerReason}
        />
      )}

      <TournamentBoard tournament={tournament} />
    </Stack>
  )
}
