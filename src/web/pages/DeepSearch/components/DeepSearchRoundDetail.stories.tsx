import Container from "@mui/material/Container"
import type { Meta, StoryObj } from "@storybook/react"

import { TextStreamProvider } from "../../../components/streaming/useTextStream.ts"
import {
  moreResearchRequestedRun,
  mixedRequirements,
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

export const RequirementCoverage: Story = {
  args: {
    run: { ...sufficientEvidenceRun, queryGenerations: [{ round: 0, streamId: "query-plan-requirements" }], searches: [], roundRequirements: [{ round: 0, requirements: mixedRequirements }] },
  },
}

export const PlanningRequirements: Story = {
  args: {
    run: { ...sufficientEvidenceRun, status: "running", finalAnswerStreamId: null, researchAnalysis: null, queryGenerations: [{ round: 0, streamId: "query-plan-incomplete" }], searches: [], roundAnswers: [], roundReviews: [] },
  },
}

export const LegacyQueryPlan: Story = {
  args: { run: { ...sufficientEvidenceRun, searches: [] } },
}

export const LinkedSourceEvidence: Story = {
  args: {
    run: {
      ...sufficientEvidenceRun,
      linkedSources: [
        {
          sourceUrl: "https://openai.com/products/",
          selectionStreamId: "linked-source-selection",
          links: [{
            url: "https://platform.openai.com/docs/overview",
            title: "API documentation and product capabilities",
            summary: { status: "stream", streamId: "linked-source-summary" },
          }],
        },
        {
          sourceUrl: "https://platform.openai.com/docs/overview",
          links: [{
            url: "https://platform.openai.com/docs/models",
            title: "Model availability and compatibility",
            summary: { status: "error", message: "The linked page could not be read. The available evidence is retained." },
          }],
        },
      ],
    },
  },
}

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
