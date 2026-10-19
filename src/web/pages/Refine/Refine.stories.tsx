import Container from "@mui/material/Container"
import type { Meta, StoryObj } from "@storybook/react"
import { RefineSessionView } from "./index.tsx"
import type { RefineSession } from "./refineSessions.ts"

const now = new Date("2026-10-19T10:00:00Z")
const prompt = "Which home battery options work for renters in London?"
const candidates = [
  { id: "portable", label: "Portable unit with no installation" },
  { id: "landlord", label: "A system a landlord can install" },
  { id: "shared", label: "A shared or community battery" },
]

function makeSession(overrides: Partial<RefineSession> = {}): RefineSession {
  return {
    id: "refine-story",
    originalPrompt: prompt,
    status: "clarifying",
    prepState: "idle",
    pendingBatchId: "batch-current",
    currentBatchId: "batch-current",
    batches: [{
      id: "batch-current",
      status: "ready",
      questions: [
        { id: "question-use", prompt: "How do you expect to use the stored energy?", candidates },
        { id: "question-budget", prompt: "What is your approximate budget?", candidates: [
          { id: "under-500", label: "Under £500" },
          { id: "500-1500", label: "£500 to £1,500" },
          { id: "flexible", label: "Flexible if savings justify it" },
        ] },
      ],
    }],
    draftAnswers: [],
    prepSearches: [
      { deepSearchJobId: "prep-1", title: "Portable batteries for UK renters", status: "completed", slug: "portable-batteries-for-renters" },
      { deepSearchJobId: "prep-2", title: "Rules for tenant energy storage", status: "running", slug: "tenant-energy-storage-rules" },
    ],
    createdAt: now,
    updatedAt: now,
    ...overrides,
  }
}

const meta = {
  title: "Pages/Refine",
  component: RefineSessionView,
  decorators: [(Story) => <Container maxWidth="md" sx={{ py: 4 }}><Story /></Container>],
  args: { onSessionChange: () => undefined },
  parameters: { router: { initialEntries: ["/refine/refine-story"] } },
} satisfies Meta<typeof RefineSessionView>

export default meta
type Story = StoryObj<typeof meta>

export const Current: Story = { args: { session: makeSession() } }

export const Preparing: Story = {
  args: { session: makeSession({ prepState: "preparing", currentBatchId: null, batches: [{ id: "batch-current", status: "preparing", questions: [] }] }) },
}

export const Failed: Story = {
  args: { session: makeSession({ prepState: "failed", batches: [{ id: "batch-current", status: "failed", questions: [] }] }) },
}

export const EmptyBatch: Story = {
  args: { session: makeSession({ batches: [{ id: "batch-current", status: "ready", questions: [] }] }) },
}

export const Completed: Story = {
  args: { session: makeSession({
    status: "research-started",
    research: { deepSearchJobId: "research-1", slug: "renter-battery-research" },
    batches: [{ id: "batch-current", status: "submitted", questions: [{ id: "question-use", prompt: "How do you expect to use the stored energy?", candidates }], answers: [{ questionId: "question-use", selectedCandidateIds: ["portable"], text: "It must be easy to move between flats.", unanswered: false }] }],
  }) },
}

export const LongContent: Story = {
  args: { session: makeSession({ originalPrompt: `${prompt} ${"Please compare purchase costs, installation requirements, fire safety, warranty, battery degradation, supplier reputation, and performance in winter. ".repeat(8)}` }) },
}

export const NarrowMobile: Story = {
  args: { session: makeSession() },
  parameters: { viewport: { defaultViewport: "mobile1" } },
}
