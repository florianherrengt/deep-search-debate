import { Container } from "@mui/material"
import type { Meta, StoryObj } from "@storybook/react"
import { TextStreamProvider } from "../../../components/streaming/useTextStream.ts"
import {
  completedRun,
  mixedRequirements,
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

export const WithComparisonTable: Story = {
  args: {
    jobSlug: "illustrative-plan-comparison",
    title: "Plan comparison",
    researchRequest: "Compare the example plans, including prices, eligibility, and important conditions.",
    run: { ...completedRun, roundAnswers: [], searches: [], researchAnalysis: null, finalAnswerStreamId: "final-answer-table" },
  },
}

export const CheckingFinalAnswer: Story = {
  args: {
    ...WithSearchResults.args,
    run: { ...sufficientEvidenceRun, status: "running", finalAnswerStreamId: "final-answer-correction", researchAnalysis: null },
  },
}

export const WithRequirementCoverage: Story = {
  args: {
    ...WithSearchResults.args,
    run: { ...completedRun, researchAnalysis: { facts: [], disagreements: [], gaps: [], assumptions: [], requirements: mixedRequirements } },
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
  parameters: {
    docs: {
      description: {
        story: "A material evidence gap names a concrete external search target. The first answer remains a candidate while another bounded round is prepared.",
      },
    },
  },
}

export const AfterAnotherResearchRound: Story = {
  args: {
    ...WithSearchResults.args,
    run: refinedAnswerRun,
  },
  parameters: {
    docs: {
      description: {
        story: "Completed two-round research presents the corrected final answer. Earlier candidates remain attached to their own rounds and retain the reasons that led to further research.",
      },
    },
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
