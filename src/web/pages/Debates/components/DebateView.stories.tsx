import { Container } from "@mui/material"
import type { Meta, StoryObj } from "@storybook/react"
import { DebateView } from "./DebateView.tsx"
import {
  completedTournament,
  semifinalTournament,
  swissTournament,
} from "../stories/fixtures.ts"

const meta: Meta<typeof DebateView> = {
  title: "Pages/Debates/Tournament",
  component: DebateView,
  parameters: { layout: "fullscreen" },
  decorators: [
    (Story) => (
      <Container maxWidth="xl" sx={{ py: 4 }}>
        <Story />
      </Container>
    ),
  ],
}

export default meta
type Story = StoryObj<typeof DebateView>

export const RunningSwiss: Story = {
  args: {
    tournament: swissTournament,
  },
}

export const RunningSemifinal: Story = {
  args: {
    tournament: semifinalTournament,
  },
}

export const Completed: Story = {
  args: {
    tournament: completedTournament,
  },
}

export const Failed: Story = {
  args: {
    tournament: {
      ...swissTournament,
      status: "failed",
      error: "The judge failed to return a valid winner. The tournament can be retried.",
    },
  },
}
