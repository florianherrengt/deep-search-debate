import { Container } from "@mui/material"
import type { Meta, StoryObj } from "@storybook/react"
import type { TextStreamEvent } from "../../../lib/textStreams.ts"
import { TextStreamProvider } from "../../../components/streaming/useTextStream.ts"
import type { IdeaJobRunState } from "../ideaJobState.ts"
import { IdeaJobView } from "./IdeaJobView.tsx"

const prompt = "Create product ideas that help independent cafés reduce food waste."

const baseRun: IdeaJobRunState = {
  status: "running",
  failedStage: null,
  researchPromptStreamId: "planning",
  research: [],
  researchSummaryStreamId: null,
  ideaGenerationStreamId: null,
  ideas: [],
  error: null,
}

const research = [
  {
    deepSearchJobId: "research-one",
    researchRequest:
      "Research current causes, costs, and workflows behind food waste in independent cafés.",
  },
  {
    deepSearchJobId: "research-two",
    researchRequest:
      "Research proven food-waste interventions and underserved software opportunities for small cafés.",
  },
]

const ideas = [
  {
    title: "Prep Forecast",
    description:
      "A lightweight morning forecast that converts weather, local events, and recent till data into recommended prep quantities.",
  },
  {
    title: "Last-Hour Bundles",
    description:
      "A one-tap tool that groups likely leftovers into timed offers without requiring staff to maintain a separate catalogue.",
  },
]

const textById: Record<string, { reasoning: string; text: string }> = {
  planning: {
    reasoning: "I am separating operational causes from validated interventions.",
    text: JSON.stringify(research.map(({ researchRequest }) => researchRequest)),
  },
  summary: {
    reasoning: "I am retaining findings that can change product design decisions.",
    text: "Waste clusters around uncertain demand, over-preparation, and staff workflows that make measurement burdensome. Small operators respond best to interventions embedded in existing till and closing routines.",
  },
  ideas: {
    reasoning: "I am turning the strongest constraints into distinct product mechanisms.",
    text: JSON.stringify(ideas),
  },
}

async function* subscribeToStoryText(
  id: string,
  _signal?: AbortSignal,
): AsyncGenerator<TextStreamEvent> {
  const value = textById[id]
  if (!value) throw new Error(`Unknown story stream: ${id}`)
  await Promise.resolve()
  yield { type: "reasoning", text: value.reasoning }
  yield { type: "text", text: value.text }
  yield { type: "done" }
}

const meta: Meta<typeof IdeaJobView> = {
  title: "Pages/Ideas",
  component: IdeaJobView,
  parameters: { layout: "fullscreen" },
  decorators: [
    (Story) => (
      <TextStreamProvider subscribe={subscribeToStoryText}>
        <Container maxWidth="sm" sx={{ py: 4 }}>
          <Story />
        </Container>
      </TextStreamProvider>
    ),
  ],
}

export default meta
type Story = StoryObj<typeof IdeaJobView>

export const PlanningResearch: Story = {
  args: { prompt, run: baseRun },
}

export const RunningDeepResearch: Story = {
  args: { prompt, run: { ...baseRun, research } },
}

export const GeneratingIdeas: Story = {
  args: {
    prompt,
    run: {
      ...baseRun,
      research,
      researchSummaryStreamId: "summary",
      ideaGenerationStreamId: "ideas",
      ideas,
    },
  },
}

export const Completed: Story = {
  args: {
    prompt,
    run: {
      ...baseRun,
      status: "completed",
      research,
      researchSummaryStreamId: "summary",
      ideaGenerationStreamId: "ideas",
      ideas,
    },
  },
}
