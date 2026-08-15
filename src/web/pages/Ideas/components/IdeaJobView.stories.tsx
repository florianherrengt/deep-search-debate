import { Container } from "@mui/material"
import type { Meta, StoryObj } from "@storybook/react"
import type { TextStreamEvent } from "../../../lib/textStreams.ts"
import type { DeepSearchJobEvent } from "../../../lib/deepSearchJobs.ts"
import { DeepSearchJobStreamProvider } from "../../../lib/useDeepSearchJob.ts"
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
  ideaEvaluations: {},
  ideaSelectionStreamId: null,
  refinementGenerationStreamIds: {},
  refinedIdeas: {},
  refinedIdeaResearch: {},
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

const selectedIdeas = ideas.map((idea) => ({
  ...idea,
  selection: "selected" as const,
}))

const rejectedIdea: IdeaJobRunState["ideas"][number] = {
  ideaId: "manual-waste-diary",
  title: "Manual Waste Diary",
  description:
    "Ask staff to record every discarded item manually at the end of each shift.",
  selection: "rejected",
}

const ideaEvaluations: IdeaJobRunState["ideaEvaluations"] = {
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
  "last-hour-bundles": {
    pros: [
      "The customer proposition is simple to understand.",
      "It fits naturally into the café's closing workflow.",
    ],
    cons: [
      "The surplus-food marketplace is already crowded.",
      "Low local customer reach could leave bundles unsold.",
    ],
    critique:
      "The concept is accessible but needs automatic bundle creation and till integration to be meaningfully differentiated.",
  },
  "manual-waste-diary": {
    pros: [
      "Requires little technical integration to launch.",
      "Creates a basic record of discarded stock.",
    ],
    cons: [
      "Manual logging creates substantial staff friction.",
      "The resulting data is likely to be incomplete and inconsistent.",
    ],
    critique:
      "The operational burden is high and the product offers little differentiation from existing waste diaries.",
  },
}

const refinementGenerationStreamIds = {
  "prep-forecast": "prep-refinement",
  "last-hour-bundles": "bundles-refinement",
}

const refinedIdeas: IdeaJobRunState["refinedIdeas"] = {
  "prep-forecast": {
    ideaId: "prep-forecast",
    title: "Confidence-Aware Prep Forecast",
    description:
      "Recommend morning prep ranges from till history, weather, and local events, with staff overrides and visible confidence.",
  },
  "last-hour-bundles": {
    ideaId: "last-hour-bundles",
    title: "Automatic Closing Bundles",
    description:
      "Create timed leftover bundles from current till inventory inside the café's existing closing workflow.",
  },
}

const completedRefinedIdeaResearch: IdeaJobRunState["refinedIdeaResearch"] = {
  "prep-forecast": {
    deepSearchJobId: "prep-research",
    title: "Confidence-Aware Prep Forecast",
    slug: "confidence-aware-prep-forecast",
    researchRequest: "Research the refined prep forecast.",
  },
  "last-hour-bundles": {
    deepSearchJobId: "bundles-research",
    title: "Automatic Closing Bundles",
    slug: "automatic-closing-bundles",
    researchRequest: "Research the refined closing bundles.",
  },
}

const selectedIdeaRun: IdeaJobRunState = {
  ...baseRun,
  research,
  researchSummaryStreamId: "summary",
  ideaGenerationStreamId: "ideas",
  ideas: selectedIdeas,
  ideaEvaluations: {
    "prep-forecast": ideaEvaluations["prep-forecast"],
    "last-hour-bundles": ideaEvaluations["last-hour-bundles"],
  },
  ideaSelectionStreamId: "selection",
}

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
  selection: {
    reasoning: "Both ideas address distinct, research-backed workflow failures.",
    text: JSON.stringify({
      selectedIdeaIds: ["prep-forecast", "last-hour-bundles"],
    }),
  },
  "research-answer-prep-research": {
    reasoning: "I am combining evidence specific to the refined forecast.",
    text: "The strongest evidence supports a low-friction pilot using till history, weather, confidence ranges, and manual overrides.",
  },
  "research-answer-bundles-research": {
    reasoning: "I am combining evidence specific to closing-time bundles.",
    text: "Comparable approaches validate demand, while automatic bundle creation and till integration address the main staff workflow risk.",
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

async function* subscribeToStoryDeepSearch(
  id: string,
  signal?: AbortSignal,
  onOpen?: () => void,
): AsyncGenerator<DeepSearchJobEvent> {
  onOpen?.()
  await Promise.resolve()
  if (id.endsWith("-pending")) {
    await new Promise<void>((resolve) => {
      if (signal?.aborted) resolve()
      else signal?.addEventListener("abort", () => resolve(), { once: true })
    })
    return
  }
  yield { type: "final-answer-stream", streamId: `research-answer-${id}` }
  yield { type: "done" }
}

const meta: Meta<typeof IdeaJobView> = {
  title: "Pages/Ideas",
  component: IdeaJobView,
  args: { jobSlug: "independent-cafe-food-waste" },
  parameters: { layout: "fullscreen" },
  decorators: [
    (Story) => (
      <DeepSearchJobStreamProvider subscribe={subscribeToStoryDeepSearch}>
        <TextStreamProvider subscribe={subscribeToStoryText}>
          <Container maxWidth="sm" sx={{ py: 4 }}>
            <Story />
          </Container>
        </TextStreamProvider>
      </DeepSearchJobStreamProvider>
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

export const EvaluatingIdeas: Story = {
  args: {
    prompt,
    title,
    run: {
      ...baseRun,
      research,
      researchSummaryStreamId: "summary",
      ideaGenerationStreamId: "ideas",
      ideas,
      ideaEvaluations: {
        "prep-forecast": ideaEvaluations["prep-forecast"],
      },
    },
  },
}

export const RefiningSelectedIdeas: Story = {
  args: {
    prompt,
    title,
    run: {
      ...selectedIdeaRun,
      refinementGenerationStreamIds: {
        "prep-forecast": "prep-refinement",
      },
    },
  },
}

export const ResearchingRefinedIdeas: Story = {
  args: {
    prompt,
    title,
    run: {
      ...selectedIdeaRun,
      refinementGenerationStreamIds,
      refinedIdeas,
      refinedIdeaResearch: {
        "prep-forecast": {
          ...completedRefinedIdeaResearch["prep-forecast"],
          deepSearchJobId: "prep-research-pending",
        },
        "last-hour-bundles": {
          ...completedRefinedIdeaResearch["last-hour-bundles"],
          deepSearchJobId: "bundles-research-pending",
        },
      },
    },
  },
}

export const Stopping: Story = {
  args: {
    prompt,
    stopRequested: true,
    title,
    run: {
      ...baseRun,
      status: "stopping",
      research,
      researchSummaryStreamId: "summary",
    },
  },
}

export const Stopped: Story = {
  args: {
    prompt,
    stopRequested: true,
    title,
    run: {
      ...baseRun,
      status: "interrupted",
      research,
      error: "Workflow stopped by user",
    },
  },
}

export const Interrupted: Story = {
  args: {
    prompt,
    stopRequested: false,
    title,
    run: {
      ...baseRun,
      status: "interrupted",
      research,
      error: "Workflow interrupted during restart recovery",
    },
  },
}

export const Completed: Story = {
  args: {
    prompt,
    title,
    run: {
      ...selectedIdeaRun,
      status: "completed",
      ideas: [...selectedIdeas, rejectedIdea],
      ideaEvaluations,
      refinementGenerationStreamIds,
      refinedIdeas,
      refinedIdeaResearch: completedRefinedIdeaResearch,
    },
  },
}
