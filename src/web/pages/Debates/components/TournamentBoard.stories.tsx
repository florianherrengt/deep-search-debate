import { Container } from "@mui/material"
import type { Meta, StoryObj } from "@storybook/react"
import {
  completedTournament,
  semifinalTournament,
  swissTournament,
} from "../stories/fixtures.ts"
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
