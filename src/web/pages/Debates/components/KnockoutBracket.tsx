import { EmojiEventsRounded } from "@mui/icons-material"
import { Box, Card, CardContent, Stack, Typography } from "@mui/material"
import type { DebateIdea, DebateMatch } from "../debateUiTypes.ts"
import { MatchCard } from "./MatchCard.tsx"

type KnockoutBracketProps = {
  semifinalMatches: DebateMatch[]
  finalMatch?: DebateMatch
  champion?: DebateIdea
  active?: boolean
  selectedMatchId?: string | null
  onSelectMatch?: (debateMatchId: string) => void
}

function EmptyMatch({ label }: { label: string }) {
  return (
    <Card variant="outlined" sx={{ borderStyle: "dashed" }}>
      <CardContent>
        <Typography color="text.secondary" variant="body2">
          {label}
        </Typography>
      </CardContent>
    </Card>
  )
}

export function KnockoutBracket({
  semifinalMatches,
  finalMatch,
  champion,
  active = true,
  selectedMatchId = null,
  onSelectMatch,
}: KnockoutBracketProps) {
  return (
    <Box sx={{ overflowX: "auto", pb: 1 }}>
      <Box
        sx={{
          display: "grid",
          gap: 2,
          gridTemplateColumns: {
            xs: "minmax(0, 1fr)",
            md: "minmax(220px, 1fr) minmax(220px, 1fr) minmax(180px, 0.8fr)",
          },
          minWidth: { md: 720 },
        }}
      >
        <Stack spacing={1.5}>
          <Typography color="text.secondary" variant="overline">
            Semifinals
          </Typography>
          {[0, 1].map((position) => {
            const match = semifinalMatches[position]
            return match ? (
              <MatchCard
                key={match.debateMatchId}
                active={active}
                match={match}
                onSelect={onSelectMatch}
                selected={selectedMatchId === match.debateMatchId}
              />
            ) : (
              <EmptyMatch
                key={position}
                label={active ? "Waiting for Swiss results" : "Tournament stopped"}
              />
            )
          })}
        </Stack>

        <Stack
          spacing={1.5}
          sx={{ alignSelf: { xs: "stretch", md: "center" } }}
        >
          <Typography color="text.secondary" variant="overline">
            Final
          </Typography>
          {finalMatch ? (
            <MatchCard
              active={active}
              match={finalMatch}
              onSelect={onSelectMatch}
              selected={selectedMatchId === finalMatch.debateMatchId}
            />
          ) : (
            <EmptyMatch
              label={active ? "Waiting for semifinal winners" : "Tournament stopped"}
            />
          )}
        </Stack>

        <Stack
          spacing={1.5}
          sx={{ alignSelf: { xs: "stretch", md: "center" } }}
        >
          <Typography color="text.secondary" variant="overline">
            Winner
          </Typography>
          <Card
            variant="outlined"
            sx={{
              borderColor: champion ? "success.main" : undefined,
            }}
          >
            <CardContent>
              <Stack spacing={1} sx={{ alignItems: "center", textAlign: "center" }}>
                <EmojiEventsRounded
                  color={champion ? "success" : "disabled"}
                  fontSize="large"
                />
                <Typography sx={{ fontWeight: 700 }} variant="body1">
                  {champion?.title ?? "To be decided"}
                </Typography>
              </Stack>
            </CardContent>
          </Card>
        </Stack>
      </Box>
    </Box>
  )
}
