import { AutoAwesomeRounded, LightbulbOutlined } from "@mui/icons-material"
import { Alert, Box, Button, Chip, Stack, Typography } from "@mui/material"
import { Link } from "react-router-dom"
import { debateStatusPresentation } from "../debatePresentation.ts"
import { getSelectedMatch, getWinner } from "../debateSelectors.ts"
import type { DebateTournament } from "../debateUiTypes.ts"
import { DebateTranscript } from "./DebateTranscript.tsx"
import { TournamentBoard } from "./TournamentBoard.tsx"
import { WinnerIdeaCard } from "./WinnerIdeaCard.tsx"

export type DebateViewProps = {
  tournament: DebateTournament
  selectedMatchId?: string | null
  onSelectMatch?: (debateMatchId: string) => void
}

export function DebateView({
  tournament,
  selectedMatchId = null,
  onSelectMatch,
}: DebateViewProps) {
  const selectedMatch = getSelectedMatch(tournament, selectedMatchId)
  const winner = getWinner(tournament)
  const status = debateStatusPresentation[tournament.status]

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
              Agent debate
            </Typography>
          </Stack>
          <Chip
            color={status.color}
            label={status.label}
            size="small"
            sx={{ alignSelf: "flex-start" }}
            variant="outlined"
          />
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
          to={`/ideas/${tournament.ideaJobId}`}
        >
          View the underlying idea generation
        </Button>
      </Stack>

      {tournament.error && (
        <Alert severity="error">
          <Stack spacing={1.5} sx={{ alignItems: "flex-start" }}>
            <Typography variant="body2">
              The debate stopped before it could finish. You can review the
              completed matches below or start a new debate.
            </Typography>
            <Button
              color="inherit"
              component={Link}
              size="small"
              to="/debates"
            >
              Start a new debate
            </Button>
          </Stack>
        </Alert>
      )}
      {winner && <WinnerIdeaCard idea={winner} />}

      <Box
        sx={{
          alignItems: "start",
          display: "grid",
          gap: 2.5,
          gridTemplateColumns: {
            xs: "minmax(0, 1fr)",
            lg: "minmax(0, 1.2fr) minmax(380px, 0.8fr)",
          },
        }}
      >
        <TournamentBoard
          onSelectMatch={onSelectMatch}
          selectedMatchId={selectedMatch?.debateMatchId}
          tournament={tournament}
        />
        {selectedMatch && (
          <Box sx={{ position: { lg: "sticky" }, top: { lg: 16 } }}>
            <DebateTranscript
              live={
                tournament.status === "running" &&
                selectedMatch.status === "running"
              }
              match={selectedMatch}
            />
          </Box>
        )}
      </Box>
    </Stack>
  )
}
