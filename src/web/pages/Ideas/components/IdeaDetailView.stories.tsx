import Container from "@mui/material/Container"
import type { Meta, StoryObj } from "@storybook/react"
import { TextStreamProvider } from "../../../components/streaming/useTextStream.ts"
import type { TextStreamEvent } from "../../../lib/textStreams.ts"
import type { IdeaJobRunState } from "../ideaJobState.ts"
import { IdeaDetailView } from "./IdeaDetailView.tsx"

const run: IdeaJobRunState = {
  status: "completed",
  failedStage: null,
  researchPromptStreamId: "planning",
  research: [],
  researchSummaryStreamId: "summary",
  ideaGenerationStreamId: "ideas",
  ideas: [
    {
      ideaId: "prep-forecast",
      title: "Prep Forecast",
      description:
        "Convert recent till data, weather, and local events into recommended morning prep quantities.",
      selection: "selected",
    },
  ],
  ideaEvaluations: {
    "prep-forecast": {
      pros: [
        "Fits the café's existing morning preparation workflow.",
        "Turns several demand signals into one concrete decision.",
      ],
      cons: [
        "Depends on sufficiently clean till data and demand history.",
        "Staff may distrust recommendations that hide uncertainty.",
      ],
      critique:
        "The idea has strong operational fit, but adoption depends on transparent confidence ranges and easy staff overrides.",
    },
  },
  ideaSelectionStreamId: "selection",
  refinementGenerationStreamIds: { "prep-forecast": "prep-refinement" },
  refinedIdeas: {
    "prep-forecast": {
      ideaId: "prep-forecast",
      title: "Confidence-Aware Prep Forecast",
      description:
        "Recommend prep ranges with visible confidence, staff overrides, and adoption criteria.",
    },
  },
  refinedIdeaResearch: {
    "prep-forecast": {
      deepSearchJobId: "prep-research",
      title: "Confidence-Aware Prep Forecast",
      slug: "confidence-aware-prep-forecast",
      researchRequest: "Research the refined prep forecast.",
    },
  },
  error: null,
}

async function* subscribeToStoryText(
  id: string,
): AsyncGenerator<TextStreamEvent> {
  await Promise.resolve()
  yield {
    type: "reasoning",
    text: "I am testing adoption friction and evidence quality.",
  }
  yield {
    type: "text",
    text: `${id}: Strong operational fit, but the forecast must expose uncertainty and allow staff overrides.`,
  }
  yield { type: "done" }
}

const meta: Meta<typeof IdeaDetailView> = {
  title: "Pages/Ideas/Idea detail",
  component: IdeaDetailView,
  args: {
    ideaId: "prep-forecast",
    jobSlug: "independent-cafe-food-waste",
    jobTitle: "Independent Café Food Waste",
    numberOfIdeas: 1,
    run,
  },
  parameters: { layout: "fullscreen" },
  decorators: [
    (Story) => (
      <TextStreamProvider subscribe={subscribeToStoryText}>
        <Container maxWidth="md" sx={{ py: 4 }}>
          <Story />
        </Container>
      </TextStreamProvider>
    ),
  ],
}

export default meta
type Story = StoryObj<typeof IdeaDetailView>

export const Completed: Story = {}

export const AwaitingSelection: Story = {
  args: {
    run: {
      ...run,
      status: "running",
      ideas: run.ideas.map((idea) => ({ ...idea, selection: "pending" })),
      refinementGenerationStreamIds: {},
      refinedIdeas: {},
      refinedIdeaResearch: {},
    },
  },
}

export const Rejected: Story = {
  args: {
    run: {
      ...run,
      ideas: run.ideas.map((idea) => ({ ...idea, selection: "rejected" })),
      refinementGenerationStreamIds: {},
      refinedIdeas: {},
      refinedIdeaResearch: {},
    },
  },
}

export const NotFound: Story = {
  args: { ideaId: "missing-idea" },
}
