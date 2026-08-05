import { Container } from "@mui/material"
import type { Meta, StoryObj } from "@storybook/react"
import { DebateTranscript } from "./DebateTranscript.tsx"
import { completedMatch, streamingMatch } from "../stories/fixtures.ts"

const meta: Meta<typeof DebateTranscript> = {
  title: "Pages/Debates/Transcript",
  component: DebateTranscript,
  parameters: { layout: "fullscreen" },
  decorators: [
    (Story) => (
      <Container maxWidth="md" sx={{ py: 4 }}>
        <Story />
      </Container>
    ),
  ],
}

export default meta
type Story = StoryObj<typeof DebateTranscript>

export const StreamingRebuttal: Story = {
  args: { match: streamingMatch },
}

export const WithJudgeVerdict: Story = {
  args: { match: completedMatch },
}

export const WaitingToStart: Story = {
  args: {
    match: {
      ...streamingMatch,
      status: "pending",
      messages: [],
    },
  },
}
