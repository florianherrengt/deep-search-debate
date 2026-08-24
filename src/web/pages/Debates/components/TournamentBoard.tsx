import {
  EmojiEventsRounded,
  ExpandMoreRounded,
  LeaderboardRounded,
} from "@mui/icons-material"
import {
  Accordion,
  AccordionDetails,
  AccordionSummary,
  Box,
  Chip,
  Divider,
  LinearProgress,
  Stack,
  Typography,
} from "@mui/material"
import { useId, useState, type ReactNode } from "react"
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
  standingsAction?: ReactNode
  tournament: DebateTournament
}

export function TournamentBoard({
  standingsAction,
  tournament,
}: TournamentBoardProps) {
  const headingId = useId()
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
  const tournamentActive =
    tournament.status === "running" && !tournament.stopRequested
  const currentRoundId =
    tournamentActive && tournament.stage === "swiss"
      ? (currentSwissRound?.debateRoundId ?? null)
      : null
  const expansionSource = `${tournament.debateJobId}:${currentRoundId ?? "none"}`
  const [roundExpansion, setRoundExpansion] = useState(() => ({
    source: expansionSource,
    expandedRoundId: currentRoundId,
  }))
  const expandedRoundId =
    roundExpansion.source === expansionSource
      ? roundExpansion.expandedRoundId
      : currentRoundId
  const showKnockout =
    tournament.stage === "semifinal" || tournament.stage === "final"
  const expectedMatchCount = tournament.expectedMatchCount

  return (
    <Stack spacing={3}>
      {tournamentActive && (
        <Stack
          aria-labelledby={`${headingId}-progress`}
          component="section"
          spacing={1.5}
        >
          <Stack
            direction="row"
            spacing={1}
            sx={{ alignItems: "center", justifyContent: "space-between" }}
          >
            <Stack direction="row" spacing={1} sx={{ alignItems: "center" }}>
              <EmojiEventsRounded color="primary" />
              <Typography
                component="h2"
                id={`${headingId}-progress`}
                variant="h6"
              >
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
                sx={{ flexGrow: 1, height: 8, borderRadius: 1 }}
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
      )}

      {showKnockout && (
        <>
          {tournamentActive && <Divider />}
          <Stack
            aria-labelledby={`${headingId}-knockout`}
            component="section"
            spacing={1.5}
          >
            <Typography
              component="h2"
              id={`${headingId}-knockout`}
              variant="h6"
            >
              Knockout
            </Typography>
            <KnockoutBracket
              active={tournamentActive}
              champion={getWinner(tournament)}
              debateSlug={tournament.slug}
              finalMatch={finalMatch}
              knockoutMatches={semifinalRound?.matches ?? []}
            />
          </Stack>
        </>
      )}

      {(tournamentActive || showKnockout) && <Divider />}
      <Box
        aria-label={
          swissRounds.length > 0 ? "Standings and debate rounds" : undefined
        }
        role={swissRounds.length > 0 ? "group" : undefined}
        sx={{
          alignItems: "start",
          display: "grid",
          gap: { xs: 3, lg: 4 },
          gridTemplateColumns: {
            xs: "minmax(0, 1fr)",
            lg:
              swissRounds.length > 0
                ? "minmax(0, 3fr) minmax(320px, 2fr)"
                : "minmax(0, 1fr)",
          },
        }}
      >
        <Stack
          aria-labelledby={`${headingId}-standings`}
          component="section"
          spacing={1.5}
          sx={{ minWidth: 0 }}
        >
          <Stack direction="row" spacing={1} sx={{ alignItems: "center" }}>
            <LeaderboardRounded color="primary" />
            <Typography
              component="h2"
              id={`${headingId}-standings`}
              variant="h6"
            >
              Standings
            </Typography>
            {standingsAction && <Box sx={{ flexGrow: 1 }} />}
            {standingsAction}
          </Stack>
          <StandingsTable
            advancedIdeaIds={advancedIdeaIds}
            ideaJobSlug={tournament.slug}
            standings={tournament.standings}
          />
        </Stack>

        {swissRounds.length > 0 && (
          <Stack
            aria-labelledby={`${headingId}-rounds`}
            component="section"
            spacing={1}
            sx={{
              borderColor: "divider",
              borderLeft: { lg: 1 },
              minWidth: 0,
              pl: { lg: 4 },
            }}
          >
            <Typography
              component="h2"
              id={`${headingId}-rounds`}
              variant="h6"
            >
              Debate rounds
            </Typography>
            <Stack
              sx={(theme) => ({
                "& > .MuiAccordion-root": {
                  borderRadius: 0,
                },
                "& > .MuiAccordion-root:first-of-type": {
                  borderTopLeftRadius: theme.shape.borderRadius,
                  borderTopRightRadius: theme.shape.borderRadius,
                },
                "& > .MuiAccordion-root:last-of-type": {
                  borderBottomLeftRadius: theme.shape.borderRadius,
                  borderBottomRightRadius: theme.shape.borderRadius,
                },
              })}
            >
              {swissRounds.map((round) => (
                <Accordion
                  key={round.debateRoundId}
                  disableGutters
                  elevation={0}
                  expanded={expandedRoundId === round.debateRoundId}
                  onChange={(_, expanded) => {
                    setRoundExpansion({
                      source: expansionSource,
                      expandedRoundId: expanded ? round.debateRoundId : null,
                    })
                  }}
                  sx={{
                    borderTop: 1,
                    borderColor: "divider",
                    "&:last-of-type": { borderBottom: 1 },
                    "&:before": { display: "none" },
                  }}
                >
                  <AccordionSummary
                    expandIcon={<ExpandMoreRounded />}
                    sx={{
                      minHeight: 44,
                      px: 1.5,
                      "&.Mui-expanded": { minHeight: 44 },
                      "& .MuiAccordionSummary-content": { my: 1 },
                      "& .MuiAccordionSummary-content.Mui-expanded": {
                        my: 1,
                      },
                    }}
                  >
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
                          to={`/debates/${encodeURIComponent(tournament.slug)}/matches/${encodeURIComponent(match.debateMatchId)}`}
                        />
                      ))}
                    </Stack>
                  </AccordionDetails>
                </Accordion>
              ))}
            </Stack>
          </Stack>
        )}
      </Box>
    </Stack>
  )
}
