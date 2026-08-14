import { Container } from "@mui/material"
import type { Meta, StoryObj } from "@storybook/react"
import {
  completedMatch,
  completedTournament,
  streamingMatch,
  swissTournament,
} from "../stories/fixtures.ts"
import { DebateMatchDetail } from "./DebateMatchDetail.tsx"

const meta: Meta<typeof DebateMatchDetail> = {
  title: "Pages/Debates/Match detail",
  component: DebateMatchDetail,
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
type Story = StoryObj<typeof DebateMatchDetail>

export const LiveMatch: Story = {
  args: { match: streamingMatch, tournament: swissTournament },
}

export const DecidedMatch: Story = {
  args: { match: completedMatch, tournament: completedTournament },
}
