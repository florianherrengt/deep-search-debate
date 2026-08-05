import {
  CheckCircleRounded,
  ForumRounded,
  HourglassEmptyRounded,
  StopCircleRounded,
} from "@mui/icons-material"
import {
  Card,
  CardActionArea,
  Chip,
  Stack,
  Typography,
} from "@mui/material"
import { alpha } from "@mui/material/styles"
import type { DebateIdea, DebateMatch } from "../debateUiTypes.ts"

export type MatchCardProps = {
  match: DebateMatch
  active?: boolean
  selected?: boolean
  onSelect?: (debateMatchId: string) => void
}

function MatchIdea({
  idea,
  winner,
}: {
  idea: DebateIdea
  winner: boolean
}) {
  return (
    <Stack
      direction="row"
      spacing={1}
      sx={{ alignItems: "center", minWidth: 0 }}
    >
      <Typography
        color="text.secondary"
        sx={{ flexShrink: 0, width: 24 }}
        variant="caption"
      >
        {idea.position + 1}
      </Typography>
      <Typography
        noWrap
        sx={{ flexGrow: 1, fontWeight: winner ? 700 : 500 }}
        variant="body2"
      >
        {idea.title}
      </Typography>
      {winner && <CheckCircleRounded color="success" fontSize="small" />}
    </Stack>
  )
}

export function MatchCard({
  match,
  active = true,
  selected = false,
  onSelect,
}: MatchCardProps) {
  const winnerId = match.winnerIdeaId
  const status =
    match.status !== "completed" && !active
      ? {
          label: "Stopped",
          icon: <StopCircleRounded />,
          color: "default" as const,
        }
      : match.status === "running"
      ? { label: "Live", icon: <ForumRounded />, color: "primary" as const }
      : match.status === "completed"
        ? { label: "Decided", icon: <CheckCircleRounded />, color: "success" as const }
        : {
            label: "Waiting",
            icon: <HourglassEmptyRounded />,
            color: "default" as const,
          }

  return (
    <Card
      variant="outlined"
      sx={(theme) => ({
        borderColor: selected ? "primary.main" : undefined,
        bgcolor: selected
          ? alpha(theme.palette.primary.main, 0.06)
          : undefined,
      })}
    >
      <CardActionArea
        aria-label={`Open ${match.firstIdea.title} versus ${match.secondIdea.title}`}
        aria-pressed={selected}
        onClick={() => onSelect?.(match.debateMatchId)}
        sx={{ p: 1.5 }}
      >
        <Stack spacing={1.25}>
          <Stack
            direction="row"
            spacing={1}
            sx={{ alignItems: "center", justifyContent: "space-between" }}
          >
            <Typography color="text.secondary" variant="overline">
              Match {match.position + 1}
            </Typography>
            <Chip
              color={status.color}
              icon={status.icon}
              label={status.label}
              size="small"
              variant={
                match.status === "running" && active ? "filled" : "outlined"
              }
            />
          </Stack>
          <MatchIdea
            idea={match.firstIdea}
            winner={winnerId === match.firstIdea.ideaId}
          />
          <MatchIdea
            idea={match.secondIdea}
            winner={winnerId === match.secondIdea.ideaId}
          />
        </Stack>
      </CardActionArea>
    </Card>
  )
}
