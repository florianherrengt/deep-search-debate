import { Container } from "@mui/material"
import type { Meta, StoryObj } from "@storybook/react"
import { TextStreamProvider } from "../../../components/streaming/useTextStream.ts"
import {
  completedRun,
  subscribeToStoryStream,
} from "./DeepSearchView.fixture.ts"
import { ResearchRound } from "./ResearchRound.tsx"

const firstRoundSearches = completedRun.searches.filter(
  ({ round }) => round === 0,
)

const meta: Meta<typeof ResearchRound> = {
  title: "Pages/Deep Search/Research Round",
  component: ResearchRound,
  decorators: [
    (Story) => (
      <TextStreamProvider subscribe={subscribeToStoryStream}>
        <Container maxWidth="md" sx={{ py: 4 }}>
          <Story />
        </Container>
      </TextStreamProvider>
    ),
  ],
  args: {
    answerStreamId: "candidate-answer-round-1",
    queryStreamId: "query-generation-round-1",
    round: 0,
    searches: firstRoundSearches,
  },
  tags: ["autodocs"],
}

export default meta

type Story = StoryObj<typeof ResearchRound>

export const WritingCandidateAnswer: Story = {
  args: {
    finished: false,
  },
}

export const ReviewingCandidateAnswer: Story = {
  args: {
    finished: false,
    review: {
      round: 0,
      streamId: "round-review-running",
      status: "running",
    },
  },
}

export const RequestsAnotherRound: Story = {
  args: {
    finished: true,
    review: {
      round: 0,
      streamId: "round-review-continue",
      status: "continue",
      reason:
        "The answer still needs independent evidence about the effect of the governance changes on accountability.",
    },
  },
}

export const AcceptedAnswer: Story = {
  args: {
    finished: true,
    review: {
      round: 0,
      streamId: "round-review-stop",
      status: "stop",
      reason:
        "The answer covers the requested products, history, and major criticisms with sufficient supporting evidence.",
    },
  },
}
