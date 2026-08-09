import {
  EmojiEventsRounded,
  ExpandMoreRounded,
  LeaderboardRounded,
} from "@mui/icons-material"
import {
  Accordion,
  AccordionDetails,
  AccordionSummary,
  Card,
  CardContent,
  Chip,
  Divider,
  LinearProgress,
  Stack,
  Typography,
} from "@mui/material"
import { debateStageLabels } from "../debatePresentation.ts"
import {
  getCompletedMatchCount,
  getCurrentSwissRound,
  getFinalMatch,
  getSemifinalRound,
  getSwissRounds,
  getWinner,
} from "../debateSelectors.ts"
import type { DebateTournament } from "../debateUiTypes.ts"
import { KnockoutBracket } from "./KnockoutBracket.tsx"
import { MatchCard } from "./MatchCard.tsx"
import { StandingsTable } from "./StandingsTable.tsx"

export type TournamentBoardProps = {
  tournament: DebateTournament
  selectedMatchId?: string | null
  onSelectMatch?: (debateMatchId: string) => void
}

export function TournamentBoard({
  tournament,
  selectedMatchId = null,
  onSelectMatch,
}: TournamentBoardProps) {
  const completedMatches = getCompletedMatchCount(tournament)
  const currentSwissRound = getCurrentSwissRound(tournament)
  const swissRounds = getSwissRounds(tournament)
  const semifinalRound = getSemifinalRound(tournament)
  const finalMatch = getFinalMatch(tournament)
  const advancedIdeaIds = new Set(
    semifinalRound?.matches.flatMap((match) => [
      match.firstIdea.ideaId,
      match.secondIdea.ideaId,
    ]) ?? [],
  )
  const tournamentActive = tournament.status === "running"
  const showKnockout =
    tournament.stage === "semifinal" || tournament.stage === "final"
  const expectedMatchCount = tournament.expectedMatchCount

  return (
    <Stack spacing={2}>
      <Card variant="outlined">
        <CardContent>
          <Stack spacing={1.5}>
            <Stack
              direction="row"
              spacing={1}
              sx={{ alignItems: "center", justifyContent: "space-between" }}
            >
              <Stack direction="row" spacing={1} sx={{ alignItems: "center" }}>
                <EmojiEventsRounded color="primary" />
                <Typography component="h2" variant="h6">
                  Debate progress
                </Typography>
              </Stack>
              <Chip
                color="primary"
                label={debateStageLabels[tournament.stage]}
                size="small"
              />
            </Stack>
            {expectedMatchCount ? (
              <Stack direction="row" spacing={1} sx={{ alignItems: "center" }}>
                <LinearProgress
                  aria-label="Debate completion"
                  sx={{ flexGrow: 1, height: 8, borderRadius: 4 }}
                  value={(completedMatches / expectedMatchCount) * 100}
                  variant="determinate"
                />
                <Typography color="text.secondary" variant="caption">
                  {completedMatches}/{expectedMatchCount} matches
                </Typography>
              </Stack>
            ) : (
              <Typography color="text.secondary" variant="body2">
                Waiting for idea selection before creating the tournament.
              </Typography>
            )}
          </Stack>
        </CardContent>
      </Card>

      {showKnockout && (
        <Card variant="outlined">
          <CardContent>
            <KnockoutBracket
              active={tournamentActive}
              champion={getWinner(tournament)}
              finalMatch={finalMatch}
              knockoutMatches={semifinalRound?.matches ?? []}
              onSelectMatch={onSelectMatch}
              selectedMatchId={selectedMatchId}
            />
          </CardContent>
        </Card>
      )}

      {swissRounds.length > 0 && (
        <Card variant="outlined">
          <CardContent sx={{ pb: 1 }}>
            <Typography component="h3" variant="subtitle1">
              Debate rounds
            </Typography>
          </CardContent>
          {swissRounds.map((round) => (
            <Accordion
              key={round.debateRoundId}
              defaultExpanded={
                round.debateRoundId === currentSwissRound?.debateRoundId
              }
              disableGutters
              elevation={0}
              square
            >
              <AccordionSummary expandIcon={<ExpandMoreRounded />}>
                <Stack
                  direction="row"
                  spacing={1}
                  sx={{ alignItems: "center", flexGrow: 1, pr: 1 }}
                >
                  <Typography sx={{ flexGrow: 1 }} variant="body2">
                    Round {round.stageRoundNumber}
                  </Typography>
                  <Chip
                    label={`${round.matches.filter((match) => match.status === "completed").length}/${round.matches.length} decided`}
                    size="small"
                    variant="outlined"
                  />
                </Stack>
              </AccordionSummary>
              <AccordionDetails>
                <Stack spacing={1}>
                  {round.matches.map((match) => (
                    <MatchCard
                      key={match.debateMatchId}
                      active={tournamentActive}
                      match={match}
                      onSelect={onSelectMatch}
                      selected={selectedMatchId === match.debateMatchId}
                    />
                  ))}
                </Stack>
              </AccordionDetails>
            </Accordion>
          ))}
        </Card>
      )}

      <Card variant="outlined">
        <CardContent sx={{ pb: 0 }}>
          <Stack direction="row" spacing={1} sx={{ alignItems: "center", mb: 1.5 }}>
            <LeaderboardRounded color="primary" />
            <Typography component="h3" variant="subtitle1">
              Standings
            </Typography>
          </Stack>
          <Divider />
        </CardContent>
        <StandingsTable
          advancedIdeaIds={advancedIdeaIds}
          standings={tournament.standings}
        />
      </Card>
    </Stack>
  )
}
