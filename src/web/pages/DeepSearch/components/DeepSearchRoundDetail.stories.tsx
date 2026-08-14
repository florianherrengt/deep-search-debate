import Container from "@mui/material/Container"
import type { Meta, StoryObj } from "@storybook/react"

import { TextStreamProvider } from "../../../components/streaming/useTextStream.ts"
import {
  moreResearchRequestedRun,
  refinedAnswerRun,
  researchRequest,
  reviewingEvidenceRun,
  subscribeToStoryStream,
  sufficientEvidenceRun,
} from "./DeepSearchView.fixture.ts"
import { DeepSearchRoundDetail } from "./DeepSearchRoundDetail.tsx"

const meta: Meta<typeof DeepSearchRoundDetail> = {
  title: "Pages/Deep Search/Round detail",
  component: DeepSearchRoundDetail,
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
    jobSlug: "openai-products-history-and-criticisms",
    jobTitle: "OpenAI products, history, and criticisms",
    maxRounds: 2,
    researchRequest,
    roundNumber: 1,
    run: sufficientEvidenceRun,
  },
  tags: ["autodocs"],
}

export default meta

type Story = StoryObj<typeof DeepSearchRoundDetail>

export const Completed: Story = {}

export const FollowUpRound: Story = {
  args: {
    roundNumber: 2,
    run: refinedAnswerRun,
  },
}

export const LoadingNextRound: Story = {
  args: {
    roundNumber: 2,
    run: moreResearchRequestedRun,
  },
}

export const StoppedWithPartialWork: Story = {
  args: {
    run: {
      ...reviewingEvidenceRun,
      error: "Research stopped while reviewing the available evidence.",
      status: "failed",
    },
  },
}
