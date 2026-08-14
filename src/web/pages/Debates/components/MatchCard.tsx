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
import { Link } from "react-router-dom"
import type { DebateIdea, DebateMatch } from "../debateUiTypes.ts"

export type MatchCardProps = {
  match: DebateMatch
  to: string
  active?: boolean
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
        sx={{
          flexGrow: 1,
          fontWeight: winner ? 700 : 500,
          overflowWrap: "anywhere",
        }}
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
  to,
  active = true,
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
            label: "Not started",
            icon: <HourglassEmptyRounded />,
            color: "default" as const,
          }

  return (
    <Card variant="outlined">
      <CardActionArea
        aria-label={`Open ${match.firstIdea.title} versus ${match.secondIdea.title}`}
        component={Link}
        sx={{ p: 1.5 }}
        to={to}
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
