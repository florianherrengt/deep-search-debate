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
import { DeepSearchOverview } from "./DeepSearchOverview.tsx"
import { DeepSearchRoundDetail } from "./DeepSearchRoundDetail.tsx"

const meta: Meta<typeof DeepSearchOverview> = {
  title: "Pages/Deep Search",
  component: DeepSearchOverview,
  parameters: {
    layout: "fullscreen",
  },
  decorators: [
    (Story) => (
      <TextStreamProvider subscribe={subscribeToStoryStream}>
        <Container maxWidth="lg" sx={{ py: 4 }}>
          <Story />
        </Container>
      </TextStreamProvider>
    ),
  ],
}

export default meta

type Story = StoryObj<typeof DeepSearchOverview>

export const WithSearchResults: Story = {
  args: {
    jobSlug: "openai-products-history-and-criticism",
    researchRequest,
    run: completedRun,
    title: "OpenAI products, history, and criticism",
  },
}

export const WithStreamingPageSummaries: Story = {
  args: {
    ...WithSearchResults.args,
    run: streamingPageSummariesRun,
  },
  render: (args) => (
    <Container disableGutters maxWidth="md">
      <DeepSearchRoundDetail
        jobSlug={args.jobSlug}
        jobTitle={args.title}
        maxRounds={2}
        researchRequest={args.researchRequest}
        roundNumber={1}
        run={args.run}
      />
    </Container>
  ),
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

export const Stopping: Story = {
  args: {
    ...WithSearchResults.args,
    run: reviewingEvidenceRun,
    stopRequested: true,
  },
}

export const Stopped: Story = {
  args: {
    ...WithSearchResults.args,
    run: {
      ...reviewingEvidenceRun,
      status: "interrupted",
      error: "Workflow stopped by user",
    },
    stopRequested: true,
  },
}

export const Interrupted: Story = {
  args: {
    ...WithSearchResults.args,
    run: {
      ...reviewingEvidenceRun,
      status: "interrupted",
      error: "Workflow interrupted during restart recovery",
    },
    stopRequested: false,
  },
}
