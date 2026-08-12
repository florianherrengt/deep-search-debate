import { Container } from "@mui/material"
import type { Meta, StoryObj } from "@storybook/react"
import { TextStreamProvider } from "../../../components/streaming/useTextStream.ts"
import {
  completedRun,
  moreResearchRequestedRun,
  refinedAnswerRun,
  researchRequest,
  reviewFailureRun,
  reviewingEvidenceRun,
  streamingPageSummariesRun,
  subscribeToStoryStream,
  sufficientEvidenceRun,
} from "./DeepSearchView.fixture.ts"
import { DeepSearchView } from "./DeepSearchView.tsx"

const meta: Meta<typeof DeepSearchView> = {
  title: "Pages/Deep Search",
  component: DeepSearchView,
  parameters: {
    layout: "fullscreen",
  },
  decorators: [
    (Story) => (
      <TextStreamProvider subscribe={subscribeToStoryStream}>
        <Container maxWidth="sm" sx={{ py: 4 }}>
          <Story />
        </Container>
      </TextStreamProvider>
    ),
  ],
}

export default meta

type Story = StoryObj<typeof DeepSearchView>

export const WithSearchResults: Story = {
  args: {
    researchRequest,
    run: completedRun,
  },
}

export const WithStreamingPageSummaries: Story = {
  args: {
    ...WithSearchResults.args,
    run: streamingPageSummariesRun,
  },
}

export const WhileReviewingEvidence: Story = {
  args: {
    ...WithSearchResults.args,
    run: reviewingEvidenceRun,
  },
}

export const WithMoreResearchRequested: Story = {
  args: {
    ...WithSearchResults.args,
    run: moreResearchRequestedRun,
  },
}

export const AfterAnotherResearchRound: Story = {
  args: {
    ...WithSearchResults.args,
    run: refinedAnswerRun,
  },
}

export const WithSufficientEvidence: Story = {
  args: {
    ...WithSearchResults.args,
    run: sufficientEvidenceRun,
  },
}

export const WithReviewFailureFallback: Story = {
  args: {
    ...WithSearchResults.args,
    run: reviewFailureRun,
  },
}
