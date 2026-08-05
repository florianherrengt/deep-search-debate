import { Container } from "@mui/material"
import type { Meta, StoryObj } from "@storybook/react"
import { useState } from "react"
import { DebateView, type DebateViewProps } from "./DebateView.tsx"
import {
  completedTournament,
  semifinalTournament,
  swissTournament,
} from "../stories/fixtures.ts"

function InteractiveDebateView(props: DebateViewProps) {
  const [selectedMatchId, setSelectedMatchId] = useState(
    props.selectedMatchId,
  )

  return (
    <DebateView
      {...props}
      onSelectMatch={setSelectedMatchId}
      selectedMatchId={selectedMatchId}
    />
  )
}

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
  render: (args) => <InteractiveDebateView {...args} />,
}

export default meta
type Story = StoryObj<typeof DebateView>

export const RunningSwiss: Story = {
  args: {
    tournament: swissTournament,
    selectedMatchId: swissTournament.rounds[1]?.matches[2]?.debateMatchId,
  },
}

export const RunningSemifinal: Story = {
  args: {
    tournament: semifinalTournament,
    selectedMatchId: "semifinal-2",
  },
}

export const Completed: Story = {
  args: {
    tournament: completedTournament,
    selectedMatchId: "final-1",
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
