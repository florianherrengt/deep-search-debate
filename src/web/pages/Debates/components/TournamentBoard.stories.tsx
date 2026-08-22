import { LeaderboardRounded } from "@mui/icons-material"
import { Container, Stack, Typography } from "@mui/material"
import type { Meta, StoryObj } from "@storybook/react"
import {
  completedTournament,
  semifinalTournament,
  swissTournament,
} from "../stories/fixtures.ts"
import { StandingsTable } from "./StandingsTable.tsx"
import { TournamentBoard } from "./TournamentBoard.tsx"

const meta: Meta<typeof TournamentBoard> = {
  title: "Pages/Debates/Tournament board",
  component: TournamentBoard,
  parameters: { layout: "fullscreen" },
  decorators: [
    (Story) => (
      <Container maxWidth="lg" sx={{ py: 4 }}>
        <Story />
      </Container>
    ),
  ],
}

export default meta
type Story = StoryObj<typeof TournamentBoard>

export const SwissRound: Story = {
  args: {
    tournament: swissTournament,
  },
}

export const Standings: Story = {
  render: () => (
    <Stack
      aria-labelledby="standings-story-heading"
      component="section"
      spacing={1.5}
      sx={{ minWidth: 0 }}
    >
      <Stack direction="row" spacing={1} sx={{ alignItems: "center" }}>
        <LeaderboardRounded color="primary" />
        <Typography component="h2" id="standings-story-heading" variant="h6">
          Standings
        </Typography>
      </Stack>
      <StandingsTable
        ideaJobSlug={swissTournament.slug}
        standings={swissTournament.standings}
      />
    </Stack>
  ),
}

export const Semifinals: Story = {
  args: {
    tournament: semifinalTournament,
  },
}

export const TournamentComplete: Story = {
  args: {
    tournament: completedTournament,
  },
}
