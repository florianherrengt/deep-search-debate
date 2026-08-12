import Container from "@mui/material/Container"
import Typography from "@mui/material/Typography"
import type { Meta, StoryObj } from "@storybook/react"
import { Link } from "react-router-dom"
import { ApiError } from "../lib/api.ts"
import { JobHistory } from "./JobHistory.tsx"
import { JobStatusBadge } from "./JobStatusBadge.tsx"

const baseCreatedAt = new Date("2026-08-12T09:30:00.000Z")

function OriginLink({
  kind,
  slug,
  title,
}: {
  kind: "debate" | "idea"
  slug: string
  title: string
}) {
  const fromDebate = kind === "debate"
  return (
    <Link to={fromDebate ? `/debates/${slug}` : `/ideas/${slug}`}>
      <Typography
        color="text.secondary"
        component="span"
        sx={{ overflowWrap: "anywhere", textDecoration: "underline" }}
        variant="caption"
      >
        {fromDebate ? "From debate: " : "From idea: "}
        {title}
      </Typography>
    </Link>
  )
}

const manualItems = [
  {
    createdAt: baseCreatedAt,
    id: "manual-completed",
    label: "Heat-pump options for London flats",
    prompt:
      "Compare realistic heat-pump options, installation constraints, and current evidence for London flats.",
    status: <JobStatusBadge status="completed" />,
    to: "/deep-search/heat-pump-options-for-london-flats",
  },
  {
    createdAt: new Date("2026-08-12T09:12:00.000Z"),
    id: "manual-running",
    label: "Community energy financing",
    prompt:
      "Research financing models that let neighbourhood groups fund local renewable-energy projects.",
    status: <JobStatusBadge status="running" />,
    to: "/deep-search/community-energy-financing",
  },
  {
    createdAt: new Date("2026-08-11T16:45:00.000Z"),
    id: "manual-interrupted",
    label: "Domestic battery recycling",
    prompt:
      "Assess the current domestic battery recycling market and the operational gaps that remain unresolved.",
    status: <JobStatusBadge status="interrupted" />,
    to: "/deep-search/domestic-battery-recycling",
  },
]

const automatedItems = [
  {
    createdAt: baseCreatedAt,
    id: "debate-search",
    label: "Evidence for time-of-use energy pricing",
    origin: (
      <OriginLink
        kind="debate"
        slug="fairer-home-energy-products"
        title="Fairer Home Energy Products"
      />
    ),
    prompt:
      "Research evidence for and against time-of-use pricing as a mechanism for reducing household energy costs.",
    status: <JobStatusBadge status="completed" />,
    to: "/deep-search/evidence-for-time-of-use-energy-pricing",
  },
  {
    createdAt: new Date("2026-08-12T09:18:00.000Z"),
    id: "idea-search",
    label: "Tenant-friendly retrofit coordination",
    origin: (
      <OriginLink
        kind="idea"
        slug="renter-energy-product-ideas"
        title="Renter Energy Product Ideas"
      />
    ),
    prompt:
      "Research coordination failures between renters, landlords, installers, and local retrofit programmes.",
    status: <JobStatusBadge status="running" />,
    to: "/deep-search/tenant-friendly-retrofit-coordination",
  },
  {
    createdAt: new Date("2026-08-11T14:20:00.000Z"),
    id: "failed-idea-search",
    label: "Smart-meter data portability",
    origin: (
      <OriginLink
        kind="idea"
        slug="household-energy-data-products"
        title="Household Energy Data Products"
      />
    ),
    prompt:
      "Research technical and regulatory constraints on portable household smart-meter data.",
    status: <JobStatusBadge status="failed" />,
    to: "/deep-search/smart-meter-data-portability",
  },
]

const meta = {
  title: "Components/Job History",
  component: JobHistory,
  parameters: { layout: "fullscreen" },
  decorators: [
    (Story) => (
      <Container maxWidth="md" sx={{ py: 4 }}>
        <Story />
      </Container>
    ),
  ],
  args: {
    emptyMessage: "No deep searches yet.",
    error: null,
    heading: "Previous searches",
    headingId: "job-history-story",
    isPending: false,
    items: manualItems,
    onRetry: () => undefined,
  },
} satisfies Meta<typeof JobHistory>

export default meta
type Story = StoryObj<typeof meta>

export const ManualSearches: Story = {}

export const AutomatedSearches: Story = {
  args: {
    emptyMessage: "No automated searches yet.",
    heading: "Automated searches",
    headingId: "automated-job-history-story",
    items: automatedItems,
  },
}

export const Loading: Story = {
  args: {
    isPending: true,
    items: undefined,
  },
}

export const Empty: Story = {
  args: {
    items: [],
  },
}

export const FailedToLoad: Story = {
  args: {
    error: new ApiError("GET", "/api/deep-search-jobs?source=manual", 503),
    items: undefined,
  },
}

export const LongAutomatedSearchOnMobile: Story = {
  parameters: {
    viewport: { defaultViewport: "mobile1" },
  },
  args: {
    emptyMessage: "No automated searches yet.",
    heading: "Automated searches",
    headingId: "long-automated-job-history-story",
    items: [
      {
        createdAt: baseCreatedAt,
        id: "long-automated-search",
        label:
          "A deliberately long automated research title that must remain readable on a narrow screen",
        origin: (
          <OriginLink
            kind="debate"
            slug="long-origin"
            title="UnbrokenGeneratedOriginTitleThatMustWrapWithoutCreatingHorizontalPageOverflow"
          />
        ),
        prompt:
          "Research a deliberately long request containing enough context to wrap across several lines without pushing the status or source link beyond the viewport.",
        status: <JobStatusBadge status="completed" />,
        to: "/deep-search/long-automated-search",
      },
    ],
  },
}
