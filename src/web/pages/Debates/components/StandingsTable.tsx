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
  Link as MuiLink,
} from "@mui/material"
import { alpha } from "@mui/material/styles"
import { Link } from "react-router-dom"
import type { DebateStanding } from "../debateUiTypes.ts"

export function StandingsTable({
  advancedIdeaIds = new Set<string>(),
  ideaJobSlug,
  standings,
}: {
  advancedIdeaIds?: ReadonlySet<string>
  ideaJobSlug: string
  standings: DebateStanding[]
}) {
  return (
    <TableContainer sx={{ maxHeight: 510 }}>
      <Table aria-label="Debate standings" size="small" stickyHeader>
        <TableHead>
          <TableRow>
            <TableCell sx={{ width: 42 }}>Rank</TableCell>
            <TableCell>Idea</TableCell>
            <TableCell align="right">Wins</TableCell>
            <TableCell align="right">Rating</TableCell>
          </TableRow>
        </TableHead>
        <TableBody>
          {standings.map((standing, index) => {
            const rank = index + 1
            const advanced = advancedIdeaIds.has(standing.idea.ideaId)

            return (
              <TableRow
                key={standing.idea.ideaId}
                sx={(theme) => ({
                  bgcolor: advanced
                    ? alpha(theme.palette.success.main, 0.055)
                    : undefined,
                })}
              >
                <TableCell>
                  <Typography
                    sx={{ fontWeight: advanced ? 700 : 500 }}
                    variant="body2"
                  >
                    {rank}
                  </Typography>
                </TableCell>
                <TableCell>
                  <MuiLink
                    component={Link}
                    sx={{ fontWeight: 600, overflowWrap: "anywhere" }}
                    to={`/ideas/${encodeURIComponent(ideaJobSlug)}/${encodeURIComponent(standing.idea.ideaId)}#improved-idea`}
                    variant="body2"
                  >
                    {standing.idea.title}
                  </MuiLink>
                  {advanced && (
                    <Chip
                      color="success"
                      icon={<EmojiEventsRounded />}
                      label="Advanced"
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
