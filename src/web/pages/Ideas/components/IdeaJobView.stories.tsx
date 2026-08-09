import { Container } from "@mui/material"
import type { Meta, StoryObj } from "@storybook/react"
import type { TextStreamEvent } from "../../../lib/textStreams.ts"
import { TextStreamProvider } from "../../../components/streaming/useTextStream.ts"
import type { IdeaJobRunState } from "../ideaJobState.ts"
import { IdeaJobView } from "./IdeaJobView.tsx"

const prompt = "Create product ideas that help independent cafés reduce food waste."
const title = "Independent Café Food Waste"

const baseRun: IdeaJobRunState = {
  status: "running",
  failedStage: null,
  researchPromptStreamId: "planning",
  research: [],
  researchSummaryStreamId: null,
  ideaGenerationStreamId: null,
  ideas: [],
  critiqueGenerationStreamIds: {},
  ideaSelectionStreamId: null,
  error: null,
}

const research = [
  {
    deepSearchJobId: "research-one",
    title: "Café Food Waste Causes",
    slug: "cafe-food-waste-causes",
    researchRequest:
      "Research current causes, costs, and workflows behind food waste in independent cafés.",
  },
  {
    deepSearchJobId: "research-two",
    title: "Proven Café Waste Interventions",
    slug: "proven-cafe-waste-interventions",
    researchRequest:
      "Research proven food-waste interventions and underserved software opportunities for small cafés.",
  },
]

const ideas = [
  {
    ideaId: "prep-forecast",
    title: "Prep Forecast",
    description:
      "A lightweight morning forecast that converts weather, local events, and recent till data into recommended prep quantities.",
    selection: "pending" as const,
  },
  {
    ideaId: "last-hour-bundles",
    title: "Last-Hour Bundles",
    description:
      "A one-tap tool that groups likely leftovers into timed offers without requiring staff to maintain a separate catalogue.",
    selection: "pending" as const,
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
  "critique-0": {
    reasoning: "I am testing this idea against adoption friction and defensibility.",
    text: "Strong operational fit, but its accuracy depends on clean till data and enough historical demand. Start with confidence ranges and manual overrides.",
  },
  "critique-1": {
    reasoning: "I am checking whether this idea has a defensible mechanism.",
    text: "Easy to understand, but crowded and vulnerable to low customer reach. Differentiate through automatic bundle creation inside existing closing workflows.",
  },
  selection: {
    reasoning: "Both ideas address distinct, research-backed workflow failures.",
    text: JSON.stringify({
      selectedIdeaIds: ["prep-forecast", "last-hour-bundles"],
    }),
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
  args: { title, prompt, run: baseRun },
}

export const RunningDeepResearch: Story = {
  args: { title, prompt, run: { ...baseRun, research } },
}

export const GeneratingIdeas: Story = {
  args: {
    prompt,
    title,
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
    title,
    run: {
      ...baseRun,
      status: "completed",
      research,
      researchSummaryStreamId: "summary",
      ideaGenerationStreamId: "ideas",
      ideas: ideas.map((idea) => ({ ...idea, selection: "selected" as const })),
      critiqueGenerationStreamIds: {
        0: "critique-0",
        1: "critique-1",
      },
      ideaSelectionStreamId: "selection",
    },
  },
}

export const CritiquingIdeas: Story = {
  args: {
    prompt,
    run: {
      ...baseRun,
      research,
      researchSummaryStreamId: "summary",
      ideaGenerationStreamId: "ideas",
      ideas,
      critiqueGenerationStreamIds: {
        0: "critique-0",
        1: "critique-1",
      },
    },
  },
}
