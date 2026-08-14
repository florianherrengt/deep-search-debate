import { EmojiEventsRounded } from "@mui/icons-material"
import { Box, Card, CardContent, Stack, Typography } from "@mui/material"
import type { DebateIdea, DebateMatch } from "../debateUiTypes.ts"
import { MatchCard } from "./MatchCard.tsx"

type KnockoutBracketProps = {
  debateSlug: string
  knockoutMatches: DebateMatch[]
  finalMatch?: DebateMatch
  champion?: DebateIdea
  active?: boolean
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
  debateSlug,
  knockoutMatches,
  finalMatch,
  champion,
  active = true,
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
            Knockout round
          </Typography>
          {knockoutMatches.length > 0 ? (
            knockoutMatches.map((match) => (
              <MatchCard
                key={match.debateMatchId}
                active={active}
                match={match}
                to={`/debates/${encodeURIComponent(debateSlug)}/matches/${encodeURIComponent(match.debateMatchId)}`}
              />
            ))
          ) : (
            <EmptyMatch
              label={active ? "Waiting for debate results" : "Debate stopped"}
            />
          )}
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
              to={`/debates/${encodeURIComponent(debateSlug)}/matches/${encodeURIComponent(finalMatch.debateMatchId)}`}
            />
          ) : (
            <EmptyMatch
              label={active ? "Waiting for knockout winners" : "Debate stopped"}
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
