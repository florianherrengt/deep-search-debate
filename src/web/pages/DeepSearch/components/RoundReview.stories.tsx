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
          "The post-round reviewer checks the candidate against accumulated evidence and identifies answer-changing gaps. It requests a focused search round when a useful external source could resolve a gap, or stops when another search would not help. The hard round limit still applies. Expand the retained reasoning in stream-backed stories to inspect how the decision was reached.",
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
        "The answer does not establish who can overrule the board after the governance changes. Search for an independent analysis of OpenAI board authority to verify whether the claimed accountability safeguards are enforceable.",
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
      streamId: "round-review-user-preference",
      status: "stop",
      reason:
        "The comparison explains each product's capabilities, but the user's preferred balance of cost, control, and support is unknown. Only the user can resolve that preference; another web search would not change the evidence.",
    },
  },
  parameters: {
    docs: {
      description: {
        story:
          "An illustrative product comparison stops with a remaining uncertainty that only the user can resolve. Completion does not claim that every question has been answered.",
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
