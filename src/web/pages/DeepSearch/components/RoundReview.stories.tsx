import { Container } from "@mui/material"
import type { Meta, StoryObj } from "@storybook/react"
import { TextStreamProvider } from "../../../components/streaming/useTextStream.ts"
import { subscribeToStoryStream } from "./DeepSearchView.fixture.ts"
import { RoundReview } from "./RoundReview.tsx"

const meta: Meta<typeof RoundReview> = {
  title: "Pages/Deep Search/Round Review",
  component: RoundReview,
  tags: ["autodocs"],
  parameters: {
    docs: {
      description: {
        component:
          "The optional post-round reviewer inspects all accumulated query summaries. It either requests another bounded search round, stops exploration, or fails non-fatally and lets final synthesis use the evidence already collected. Expand the retained reasoning in stream-backed stories to inspect how the decision was reached.",
      },
    },
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

type Story = StoryObj<typeof RoundReview>

export const ReviewingEvidence: Story = {
  args: {
    review: {
      round: 0,
      streamId: "round-review-running",
      status: "running",
    },
  },
  parameters: {
    docs: {
      description: {
        story:
          "A structured review generation is active. Its hidden reasoning streams independently while no decision alert is shown yet.",
      },
    },
  },
}

export const RequestsAnotherRound: Story = {
  args: {
    review: {
      round: 0,
      streamId: "round-review-continue",
      status: "continue",
      reason:
        "The official product and history sources are strong, but an independent source is still needed to verify how the governance changes affected accountability.",
    },
  },
  parameters: {
    docs: {
      description: {
        story:
          "The reviewer identified a specific, searchable evidence gap. The coordinator may start another round only while the hard round limit permits it.",
      },
    },
  },
}

export const StopsResearch: Story = {
  args: {
    review: {
      round: 1,
      streamId: "round-review-stop",
      status: "stop",
      reason:
        "The completed searches now cover the requested products, history, and major criticisms with both primary and independent sources.",
    },
  },
  parameters: {
    docs: {
      description: {
        story:
          "The reviewer considers the accumulated evidence sufficient and stops exploration before final synthesis.",
      },
    },
  },
}

export const FailedBeforeGeneration: Story = {
  args: {
    review: {
      round: 0,
      status: "error",
      reason:
        "The review could not be started, so final synthesis used the evidence already collected.",
    },
  },
  parameters: {
    docs: {
      description: {
        story:
          "Review registration failed before a stream existed. This is non-fatal: the pipeline keeps the current evidence and proceeds to final synthesis.",
      },
    },
  },
}

export const FailedDuringGeneration: Story = {
  args: {
    review: {
      round: 0,
      streamId: "round-review-failed",
      status: "error",
      reason:
        "The reviewer did not return a valid decision, so final synthesis used the evidence already collected.",
    },
  },
  parameters: {
    docs: {
      description: {
        story:
          "A registered review stream failed. The retained generation error remains inspectable and the workflow separately explains its non-fatal fallback.",
      },
    },
  },
}

export const LongEvidenceGapOnMobile: Story = {
  args: {
    review: {
      round: 0,
      streamId: "round-review-continue",
      status: "continue",
      reason:
        "The current searches describe the company's stated safety approach and summarize external governance criticism, but they do not provide a dated, independent account of how the board changes altered formal oversight, what authority remained with the nonprofit entity, or whether those changes addressed the accountability concerns raised by researchers and former employees.",
    },
  },
  parameters: {
    docs: {
      description: {
        story:
          "A deliberately long continuation reason at a narrow viewport, covering wrapping and readability under realistic model output.",
      },
    },
    viewport: { defaultViewport: "mobile1" },
  },
}
