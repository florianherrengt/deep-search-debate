import { EmojiEventsRounded } from "@mui/icons-material"
import {
  Chip,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  Typography,
} from "@mui/material"
import { alpha } from "@mui/material/styles"
import type { DebateStanding } from "../debateUiTypes.ts"

export function StandingsTable({
  standings,
  qualification = "final",
}: {
  standings: DebateStanding[]
  qualification?: "hidden" | "provisional" | "final"
}) {
  return (
    <TableContainer sx={{ maxHeight: 510 }}>
      <Table aria-label="Swiss tournament standings" size="small" stickyHeader>
        <TableHead>
          <TableRow>
            <TableCell sx={{ width: 42 }}>Rank</TableCell>
            <TableCell>Idea</TableCell>
            <TableCell align="right">Wins</TableCell>
            <TableCell align="right">Elo</TableCell>
          </TableRow>
        </TableHead>
        <TableBody>
          {standings.map((standing, index) => {
            const rank = index + 1
            const highlighted = qualification !== "hidden" && rank <= 4
            const finalized = qualification === "final"

            return (
              <TableRow
                key={standing.idea.ideaId}
                sx={(theme) => ({
                  bgcolor: highlighted
                    ? alpha(
                        finalized
                          ? theme.palette.success.main
                          : theme.palette.primary.main,
                        0.055,
                      )
                    : undefined,
                })}
              >
                <TableCell>
                  <Typography
                    sx={{ fontWeight: highlighted ? 700 : 500 }}
                    variant="body2"
                  >
                    {rank}
                  </Typography>
                </TableCell>
                <TableCell>
                  <Typography sx={{ fontWeight: 600 }} variant="body2">
                    {standing.idea.title}
                  </Typography>
                  {highlighted && (
                    <Chip
                      color={finalized ? "success" : "primary"}
                      icon={<EmojiEventsRounded />}
                      label={finalized ? "Top four" : "Provisional top four"}
                      size="small"
                      sx={{ mt: 0.5 }}
                      variant="outlined"
                    />
                  )}
                </TableCell>
                <TableCell align="right">{standing.wins}</TableCell>
                <TableCell align="right">{Math.round(standing.elo)}</TableCell>
              </TableRow>
            )
          })}
        </TableBody>
      </Table>
    </TableContainer>
  )
}
