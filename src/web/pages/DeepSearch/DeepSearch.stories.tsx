import Container from "@mui/material/Container"
import type { Meta, StoryObj } from "@storybook/react"
import type { DeepSearchJobListItem } from "../../lib/deepSearchJobs.ts"
import {
  DeepSearch,
  type DeepSearchServices,
} from "./index.tsx"

const createdAt = new Date("2026-08-12T09:30:00.000Z")

const manualJobs: DeepSearchJobListItem[] = [
  {
    completedAt: new Date("2026-08-12T09:38:00.000Z"),
    createdAt,
    deepSearchJobId: "manual-completed",
    error: null,
    maxResultsPerSearch: 3,
    maxRounds: 3,
    maxSearches: 3,
    origin: null,
    researchRequest:
      "Compare realistic heat-pump options, installation constraints, and current evidence for London flats.",
    slug: "heat-pump-options-for-london-flats",
    status: "completed",
    stopRequested: false,
    title: "Heat-pump options for London flats",
  },
  {
    completedAt: null,
    createdAt: new Date("2026-08-12T09:12:00.000Z"),
    deepSearchJobId: "manual-running",
    error: null,
    maxResultsPerSearch: 3,
    maxRounds: 3,
    maxSearches: 3,
    origin: null,
    researchRequest:
      "Research financing models that let neighbourhood groups fund local renewable-energy projects.",
    slug: "community-energy-financing",
    status: "running",
    stopRequested: false,
    title: "Community energy financing",
  },
]

const automatedJobs: DeepSearchJobListItem[] = [
  {
    completedAt: new Date("2026-08-12T09:44:00.000Z"),
    createdAt,
    deepSearchJobId: "debate-search",
    error: null,
    maxResultsPerSearch: 3,
    maxRounds: 3,
    maxSearches: 3,
    origin: {
      kind: "debate",
      slug: "fairer-home-energy-products",
      title: "Fairer Home Energy Products",
    },
    researchRequest:
      "Research evidence for and against time-of-use pricing as a mechanism for reducing household energy costs.",
    slug: "evidence-for-time-of-use-energy-pricing",
    status: "completed",
    stopRequested: false,
    title: "Evidence for time-of-use energy pricing",
  },
  {
    completedAt: null,
    createdAt: new Date("2026-08-12T09:18:00.000Z"),
    deepSearchJobId: "idea-search",
    error: null,
    maxResultsPerSearch: 3,
    maxRounds: 3,
    maxSearches: 3,
    origin: {
      kind: "idea",
      slug: "renter-energy-product-ideas",
      title: "Renter Energy Product Ideas",
    },
    researchRequest:
      "Research coordination failures between renters, landlords, installers, and local retrofit programmes.",
    slug: "tenant-friendly-retrofit-coordination",
    status: "running",
    stopRequested: false,
    title: "Tenant-friendly retrofit coordination",
  },
]

const services: DeepSearchServices = {
  createJob: () =>
    Promise.resolve({
      deepSearchJobId: "new-story-search",
      slug: "new-story-search",
    }),
  getJob: (slug) =>
    Promise.resolve({
      completedAt: new Date("2026-08-12T09:38:00.000Z"),
      createdAt,
      deepSearchJobId: slug,
      canStop: false,
      creditsUsed: 123,
      error: null,
      feedback: { rating: null, hasWrittenFeedback: false },
      isIndexable: false,
      isPublic: false,
      maxResultsPerSearch: 3,
      maxRounds: 3,
      maxSearches: 3,
      researchRequest: "Research request created from the Storybook page.",
      slug,
      status: "completed",
      stopRequested: false,
      title: "Storybook deep search",
    }),
  getJobs: (source) =>
    Promise.resolve(source === "automated" ? automatedJobs : manualJobs),
  stopJob: () => Promise.reject(new Error("Story jobs cannot be stopped")),
}

const meta = {
  title: "Pages/Deep Search/History",
  component: DeepSearch,
  parameters: {
    layout: "fullscreen",
    router: { initialEntries: ["/deep-search"] },
  },
  decorators: [
    (Story) => (
      <Container maxWidth="md" sx={{ py: 4 }}>
        <Story />
      </Container>
    ),
  ],
  args: { services },
} satisfies Meta<typeof DeepSearch>

export default meta
type Story = StoryObj<typeof meta>

export const ManualSelected: Story = {}

export const AutomatedSelected: Story = {
  parameters: {
    router: { initialEntries: ["/deep-search?source=automated"] },
  },
}
