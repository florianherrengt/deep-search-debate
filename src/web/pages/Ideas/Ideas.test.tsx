import {
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react"
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { MemoryRouter, Route, Routes } from "react-router-dom"
import { beforeEach, describe, expect, it, vi } from "vitest"

const mocks = vi.hoisted(() => ({
  createIdeaJob: vi.fn(),
  getIdeaJob: vi.fn(),
  getIdeaJobs: vi.fn(),
  subscribeToDeepSearchJob: vi.fn(),
  subscribeToIdeaJob: vi.fn(),
  subscribeToTextStream: vi.fn(),
}))

vi.mock("../../lib/ideaJobs.ts", () => ({
  createIdeaJob: mocks.createIdeaJob,
  getIdeaJob: mocks.getIdeaJob,
  getIdeaJobs: mocks.getIdeaJobs,
  subscribeToIdeaJob: mocks.subscribeToIdeaJob,
}))

vi.mock("../../lib/textStreams.ts", () => ({
  subscribeToTextStream: mocks.subscribeToTextStream,
}))

vi.mock("../../lib/deepSearchJobs.ts", () => ({
  subscribeToDeepSearchJob: mocks.subscribeToDeepSearchJob,
}))

import { Ideas } from "./index.tsx"
import { IdeaDetailView } from "./components/IdeaDetailView.tsx"
import { IdeaJobView } from "./components/IdeaJobView.tsx"

function renderIdeas(initialEntry = "/ideas") {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  })
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={[initialEntry]}>
        <Routes>
          <Route path="/ideas" element={<Ideas />} />
          <Route path="/ideas/:slug" element={<Ideas />} />
          <Route path="/ideas/:slug/:ideaId" element={<Ideas />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  )
}

describe("Ideas", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.getIdeaJobs.mockResolvedValue([])
    mocks.createIdeaJob.mockResolvedValue({
      ideaJobId: "idea-job-id",
      slug: "independent-cafe-ideas",
    })
    mocks.getIdeaJob.mockResolvedValue({
      ideaJobId: "idea-job-id",
      title: "Independent Café Ideas",
      slug: "independent-cafe-ideas",
      prompt: "Ideas for independent cafés",
      numberOfIdeas: 12,
      deepSearchCount: 2,
      isIndexable: false,
      isPublic: false,
      stage: "planning",
      status: "running",
      error: null,
      createdAt: new Date(),
      completedAt: null,
    })
  })

  it("creates a run and shows streamed progress and individual ideas", async () => {
    async function* ideaEvents(_id: string, signal?: AbortSignal) {
      yield { type: "research-prompt-stream" as const, streamId: "planning" }
      yield {
        type: "deep-search-started" as const,
        deepSearchJobId: "search-one",
        title: "Café Waste Causes",
        slug: "cafe-waste-causes",
        researchRequest: "Research café waste causes",
      }
      yield {
        type: "deep-search-started" as const,
        deepSearchJobId: "search-two",
        title: "Proven Café Interventions",
        slug: "proven-cafe-interventions",
        researchRequest: "Research proven café interventions",
      }
      yield { type: "research-summary-stream" as const, streamId: "summary" }
      yield { type: "idea-generation-stream" as const, streamId: "ideas" }
      yield {
        type: "idea" as const,
        ideaId: "prep-forecast-id",
        title: "Prep Forecast",
        description: "Recommend daily prep quantities from recent demand.",
      }
      yield {
        type: "critique-generation-stream" as const,
        position: 0,
        streamId: "critique",
      }
      await new Promise<void>((resolve) => {
        if (signal?.aborted) resolve()
        else signal?.addEventListener("abort", () => resolve(), { once: true })
      })
    }
    async function* textEvents(id: string) {
      await Promise.resolve()
      yield { type: "reasoning" as const, text: `Reasoning for ${id}` }
      yield {
        type: "text" as const,
        text: id === "ideas" ? '[{"title":"Prep Forecast"}]' : `${id} text`,
      }
      yield { type: "done" as const }
    }
    mocks.subscribeToIdeaJob.mockImplementation(ideaEvents)
    mocks.subscribeToTextStream.mockImplementation(textEvents)

    renderIdeas()
    const submit = screen.getByRole("button", { name: "Generate ideas" })
    expect(submit).toBeDisabled()
    fireEvent.change(
      screen.getByLabelText("What should we generate ideas for?"),
      { target: { value: "Ideas for independent cafés" } },
    )
    expect(submit).toBeEnabled()
    fireEvent.click(submit)

    expect(await screen.findByText("Prep Forecast")).toBeVisible()
    expect(
      screen.queryByText("Recommend daily prep quantities from recent demand."),
    ).not.toBeInTheDocument()
    const ideaLink = screen.getByRole("link", { name: "View Prep Forecast" })
    expect(ideaLink).toHaveAttribute(
      "href",
      "/ideas/independent-cafe-ideas/prep-forecast-id",
    )
    expect(ideaLink).toHaveAttribute("target", "_blank")
    expect(ideaLink).toHaveAttribute("rel", "noopener noreferrer")
    expect(screen.queryByTestId("idea-critique-0")).not.toBeInTheDocument()
    expect(screen.queryByText("Raw structured output")).not.toBeInTheDocument()
    expect(mocks.createIdeaJob).toHaveBeenCalledWith({
      prompt: "Ideas for independent cafés",
    })
    fireEvent.click(
      screen.getByRole("button", { name: /Deep research Complete/ }),
    )
    expect(
      screen.getByRole("link", { name: "Café Waste Causes" }),
    ).toHaveAttribute("href", "/deep-search/cafe-waste-causes")
    expect(
      screen.getByRole("link", { name: "Café Waste Causes" }),
    ).toHaveAttribute("target", "_blank")
    expect(
      screen.getByRole("link", {
        name: "Proven Café Interventions",
      }),
    ).toHaveAttribute("href", "/deep-search/proven-cafe-interventions")

  })

  it("shows one idea list with selection progress and reasoning", async () => {
    mocks.subscribeToTextStream.mockImplementation(async function* (id: string) {
      await Promise.resolve()
      yield { type: "reasoning" as const, text: "Critique reasoning" }
      yield { type: "text" as const, text: `Response from ${id}` }
      yield { type: "done" as const }
    })
    render(
      <MemoryRouter>
        <IdeaJobView
          jobSlug="generated-ideas"
          title="Generated ideas"
          prompt="Generate ideas"
          run={{
          status: "running",
          failedStage: null,
          researchPromptStreamId: null,
          research: [],
          researchSummaryStreamId: null,
          ideaGenerationStreamId: null,
          ideas: [
            {
              ideaId: "prep-forecast-id",
              title: "Prep Forecast",
              description: "Recommend daily prep quantities from recent demand.",
              selection: "selected",
            },
            {
              ideaId: "closing-bundles-id",
              title: "Closing Bundles",
              description: "Bundle likely leftovers before closing time.",
              selection: "rejected",
            },
            {
              ideaId: "demand-signals-id",
              title: "Demand Signals",
              description: "Surface local demand signals for café staff.",
              selection: "selected",
            },
          ],
          critiqueGenerationStreamIds: {
            0: "prep-critique",
            1: "bundle-critique",
          },
          ideaSelectionStreamId: "selection",
          refinementGenerationStreamIds: {
            "prep-forecast-id": "prep-refinement",
            "demand-signals-id": "demand-signals-refinement",
          },
          refinedIdeas: {
            "prep-forecast-id": {
              ideaId: "prep-forecast-id",
              title: "Confidence-Aware Prep Forecast",
              description: "Recommend prep ranges with staff overrides.",
            },
          },
          refinedIdeaResearch: {
            "prep-forecast-id": {
              deepSearchJobId: "prep-research",
              title: "Confidence-Aware Prep Forecast",
              slug: "confidence-aware-prep-forecast",
              researchRequest: "Research the improved prep forecast.",
            },
          },
          error: null,
          }}
        />
      </MemoryRouter>,
    )

    const reasoningToggle = await screen.findByRole("button", {
      name: "Show reasoning",
    })
    await waitFor(() =>
      expect(screen.getByRole("status")).toHaveTextContent("Response complete"),
    )

    expect(
      screen.getByRole("button", { name: /Generate ideas Complete/ }),
    ).toHaveAttribute("aria-expanded", "true")
    expect(
      screen.getByRole("link", {
        name: "View Confidence-Aware Prep Forecast",
      }),
    ).toHaveAttribute(
      "href",
      "/ideas/generated-ideas/prep-forecast-id#improved-idea",
    )
    expect(screen.getByRole("link", { name: "View Closing Bundles" })).toHaveAttribute(
      "href",
      "/ideas/generated-ideas/closing-bundles-id",
    )
    expect(
      screen.getByRole("link", { name: "View Demand Signals" }),
    ).toHaveAttribute("href", "/ideas/generated-ideas/demand-signals-id")
    expect(
      screen.queryByRole("link", { name: "View selected Prep Forecast" }),
    ).not.toBeInTheDocument()
    expect(
      screen.queryByRole("link", {
        name: "View improved Confidence-Aware Prep Forecast",
      }),
    ).not.toBeInTheDocument()
    expect(screen.queryByTestId("idea-critique-0")).not.toBeInTheDocument()
    expect(screen.queryByTestId("idea-critique-1")).not.toBeInTheDocument()
    expect(screen.getByText("Rejected")).toBeVisible()
    expect(screen.getByText("Improved")).toBeVisible()
    expect(screen.getByText("Improving")).toBeVisible()
    expect(screen.queryByTestId("idea-selection")).not.toBeInTheDocument()
    expect(mocks.subscribeToTextStream).toHaveBeenCalledWith(
      "selection",
      expect.any(AbortSignal),
      expect.any(Function),
    )
    expect(screen.queryByText("Response from selection")).not.toBeInTheDocument()
    fireEvent.click(reasoningToggle)
    expect(screen.getByText("Critique reasoning")).toBeVisible()
    expect(screen.getByText("2 ideas selected.")).toBeVisible()
    expect(
      screen.queryByRole("button", { name: /Select ideas/ }),
    ).not.toBeInTheDocument()
    expect(
      screen.queryByRole("button", { name: /Critique each idea/ }),
    ).not.toBeInTheDocument()
    expect(screen.queryByText("Raw structured output")).not.toBeInTheDocument()
  })

  it("shows one idea's details and links to research without rendering it", async () => {
    mocks.subscribeToTextStream.mockImplementation(async function* (id: string) {
      await Promise.resolve()
      yield { type: "reasoning" as const, text: "Research reasoning" }
      yield { type: "text" as const, text: `Response from ${id}` }
      yield { type: "done" as const }
    })

    render(
      <MemoryRouter>
        <IdeaDetailView
          ideaId="prep-forecast-id"
          jobSlug="generated-ideas"
          jobTitle="Generated ideas"
          numberOfIdeas={1}
          run={{
            status: "completed",
            failedStage: null,
            researchPromptStreamId: null,
            research: [],
            researchSummaryStreamId: null,
            ideaGenerationStreamId: null,
            ideas: [
              {
                ideaId: "prep-forecast-id",
                title: "Prep Forecast",
                description: "Recommend fixed prep quantities.",
                selection: "selected",
              },
            ],
            critiqueGenerationStreamIds: { 0: "prep-critique" },
            ideaSelectionStreamId: null,
            refinementGenerationStreamIds: {
              "prep-forecast-id": "refinement",
            },
            refinedIdeas: {
              "prep-forecast-id": {
                ideaId: "prep-forecast-id",
                title: "Confidence-Aware Prep Forecast",
                description:
                  "Recommend prep ranges with confidence and staff overrides.",
              },
            },
            refinedIdeaResearch: {
              "prep-forecast-id": {
                deepSearchJobId: "prep-research",
                title: "Confidence-Aware Prep Forecast",
                slug: "confidence-aware-prep-forecast",
                researchRequest: "Research the improved prep forecast.",
              },
            },
            error: null,
          }}
        />
      </MemoryRouter>,
    )

    expect(
      screen.getByRole("heading", {
        level: 1,
        name: "Confidence-Aware Prep Forecast",
      }),
    ).toBeVisible()
    expect(screen.getByText("Prep Forecast")).toBeVisible()
    expect(
      screen.getByText(
        "Recommend prep ranges with confidence and staff overrides.",
      ),
    ).toBeVisible()
    expect(await screen.findByTestId("idea-critique-0")).toHaveTextContent(
      "Response from prep-critique",
    )
    expect(screen.queryByTestId("idea-research-prep-research")).toBeNull()
    expect(mocks.subscribeToDeepSearchJob).not.toHaveBeenCalled()
    expect(
      screen.getByRole("link", { name: "Open full research" }),
    ).toHaveAttribute("href", "/deep-search/confidence-aware-prep-forecast")
    expect(screen.getByRole("link", { name: "Back to ideas" })).toHaveAttribute(
      "href",
      "/ideas/generated-ideas",
    )
  })

  it("shows persisted ideas before their critique calls start", () => {
    render(
      <MemoryRouter>
        <IdeaJobView
          jobSlug="generated-ideas"
          prompt="Generate ideas"
          title="Generated ideas"
          run={{
          status: "running",
          failedStage: null,
          researchPromptStreamId: "planning",
          research: [],
          researchSummaryStreamId: "summary",
          ideaGenerationStreamId: "ideas",
          ideas: [
            {
              ideaId: "prep-forecast-id",
              title: "Prep Forecast",
              description: "Recommend daily prep quantities from recent demand.",
              selection: "pending",
            },
          ],
          critiqueGenerationStreamIds: {},
          ideaSelectionStreamId: null,
          refinementGenerationStreamIds: {},
          refinedIdeas: {},
          refinedIdeaResearch: {},
          error: null,
          }}
        />
      </MemoryRouter>,
    )

    expect(
      screen.getByRole("button", { name: /Generate ideas Running/ }),
    ).toBeVisible()
    expect(screen.getByRole("link", { name: "View Prep Forecast" })).toBeVisible()
    expect(screen.getByText("Awaiting selection")).toBeVisible()
    expect(screen.getByText(/Critiquing ideas/)).toBeVisible()
    expect(screen.queryByText("Critique pending…")).not.toBeInTheDocument()
    expect(
      screen.queryByRole("button", { name: /Critique each idea/ }),
    ).not.toBeInTheDocument()
    expect(screen.queryByText("Generating ideas…")).not.toBeInTheDocument()
  })

  it("marks the stage that failed instead of treating its stream as complete", () => {
    mocks.subscribeToTextStream.mockImplementation(async function* (
      _id: string,
      signal?: AbortSignal,
    ) {
      await new Promise<void>((resolve) => {
        if (signal?.aborted) resolve()
        else signal?.addEventListener("abort", () => resolve(), { once: true })
      })
      yield { type: "done" as const }
    })

    render(
      <IdeaJobView
        jobSlug="generated-ideas"
        title="Generated ideas"
        prompt="Generate ideas"
        run={{
          status: "failed",
          failedStage: "planning",
          researchPromptStreamId: "planning",
          research: [],
          researchSummaryStreamId: null,
          ideaGenerationStreamId: null,
          ideas: [],
          critiqueGenerationStreamIds: {},
          ideaSelectionStreamId: null,
          refinementGenerationStreamIds: {},
          refinedIdeas: {},
          refinedIdeaResearch: {},
          error: "Planning failed",
        }}
      />,
    )

    expect(
      screen.getByRole("button", { name: /Plan the research Failed/ }),
    ).toBeVisible()
  })

  it("uses the reported failure stage instead of the last stream boundary", () => {
    mocks.subscribeToTextStream.mockImplementation(async function* (
      _id: string,
      signal?: AbortSignal,
    ) {
      await new Promise<void>((resolve) => {
        if (signal?.aborted) resolve()
        else signal?.addEventListener("abort", () => resolve(), { once: true })
      })
      yield { type: "done" as const }
    })

    render(
      <IdeaJobView
        jobSlug="generated-ideas"
        title="Generated ideas"
        prompt="Generate ideas"
        run={{
          status: "failed",
          failedStage: "ideas",
          researchPromptStreamId: "planning",
          research: [],
          researchSummaryStreamId: "summary",
          ideaGenerationStreamId: null,
          ideas: [],
          critiqueGenerationStreamIds: {},
          ideaSelectionStreamId: null,
          refinementGenerationStreamIds: {},
          refinedIdeas: {},
          refinedIdeaResearch: {},
          error: "Idea generation failed before streaming",
        }}
      />,
    )

    expect(
      screen.getByRole("button", { name: /Generate ideas Failed/ }),
    ).toBeVisible()
    expect(
      screen.getByRole("button", { name: /Summarise the research Complete/ }),
    ).toBeVisible()
  })

  it("marks the combined idea stage failed when critique creation fails", () => {
    render(
      <MemoryRouter>
        <IdeaJobView
          jobSlug="generated-ideas"
          prompt="Generate ideas"
          title="Generated ideas"
          run={{
          status: "failed",
          failedStage: "critique",
          researchPromptStreamId: "planning",
          research: [],
          researchSummaryStreamId: "summary",
          ideaGenerationStreamId: "ideas",
          ideas: [
            {
              ideaId: "prep-forecast-id",
              title: "Prep Forecast",
              description: "Recommend daily prep quantities from recent demand.",
              selection: "pending",
            },
          ],
          critiqueGenerationStreamIds: {},
          ideaSelectionStreamId: null,
          refinementGenerationStreamIds: {},
          refinedIdeas: {},
          refinedIdeaResearch: {},
          error: "Critique failed before streaming",
          }}
        />
      </MemoryRouter>,
    )

    expect(
      screen.getByRole("button", { name: /Generate ideas Failed/ }),
    ).toBeVisible()
    expect(screen.getByRole("link", { name: "View Prep Forecast" })).toBeVisible()
    expect(screen.getByText("Selection incomplete")).toBeVisible()
    expect(screen.queryByText("Awaiting selection")).not.toBeInTheDocument()
    expect(
      screen.queryByText("Critique did not start for this idea."),
    ).not.toBeInTheDocument()
  })

  it("stops loading an invalid idea after every expected idea arrives", async () => {
    document.head
      .querySelectorAll(
        'meta[name="robots"], link[rel="canonical"], script[data-seo-json-ld="true"]',
      )
      .forEach((element) => element.remove())
    document.title = "Previous public idea — RethinkLoop"
    document.documentElement.dataset.seoPage = "/ideas/previous/public-idea"
    const canonical = document.createElement("link")
    canonical.rel = "canonical"
    canonical.href = "https://rethinkloop.com/ideas/previous/public-idea"
    document.head.appendChild(canonical)
    const robots = document.createElement("meta")
    robots.name = "robots"
    robots.content = "index, follow"
    document.head.appendChild(robots)

    mocks.getIdeaJob.mockResolvedValue({
      ideaJobId: "idea-job-id",
      title: "Independent Café Ideas",
      slug: "independent-cafe-ideas",
      prompt: "Ideas for independent cafés",
      numberOfIdeas: 1,
      deepSearchCount: 2,
      isIndexable: false,
      isPublic: false,
      stage: "ideas",
      status: "running",
      error: null,
      createdAt: new Date(),
      completedAt: null,
    })
    mocks.subscribeToIdeaJob.mockImplementation(async function* (
      _id: string,
      signal?: AbortSignal,
    ) {
      yield { type: "idea-generation-stream" as const, streamId: "ideas" }
      yield {
        type: "idea" as const,
        ideaId: "prep-forecast-id",
        title: "Prep Forecast",
        description: "Recommend daily prep quantities.",
      }
      await new Promise<void>((resolve) => {
        if (signal?.aborted) resolve()
        else signal?.addEventListener("abort", () => resolve(), { once: true })
      })
    })

    renderIdeas("/ideas/independent-cafe-ideas/missing-idea")

    expect(
      await screen.findByRole("heading", { name: "Idea not found" }),
    ).toBeVisible()
    expect(
      screen.queryByRole("heading", { name: "Loading idea…" }),
    ).not.toBeInTheDocument()
    await waitFor(() =>
      expect(document.title).toBe("Idea not found — RethinkLoop"),
    )
    expect(document.head.querySelector('meta[name="robots"]')).toHaveAttribute(
      "content",
      "noindex, nofollow",
    )
    expect(document.head.querySelector('link[rel="canonical"]')).toBeNull()
  })

  it("uses the individual refined idea as public article metadata", async () => {
    mocks.getIdeaJob.mockResolvedValue({
      ideaJobId: "idea-job-id",
      title: "Independent Café Ideas",
      slug: "independent-cafe-ideas",
      prompt: "Ideas for independent cafés",
      numberOfIdeas: 1,
      deepSearchCount: 2,
      isIndexable: true,
      isPublic: true,
      stage: "ideas",
      status: "completed",
      error: null,
      createdAt: new Date(),
      completedAt: new Date(),
    })
    mocks.subscribeToIdeaJob.mockImplementation(async function* () {
      await Promise.resolve()
      yield {
        type: "idea" as const,
        ideaId: "prep-forecast-id",
        title: "Prep Forecast",
        description: "Recommend fixed prep quantities.",
      }
      yield {
        type: "refined-idea" as const,
        ideaId: "prep-forecast-id",
        title: "Confidence-Aware Prep Forecast",
        description: "Recommend prep ranges with staff overrides.",
      }
      yield { type: "done" as const }
    })

    renderIdeas("/ideas/independent-cafe-ideas/prep-forecast-id")

    await screen.findByRole("heading", {
      name: "Confidence-Aware Prep Forecast",
    })
    await waitFor(() =>
      expect(document.title).toBe(
        "Confidence-Aware Prep Forecast — RethinkLoop",
      ),
    )
    expect(document.head.querySelector('meta[name="robots"]')).toHaveAttribute(
      "content",
      "index, follow",
    )
    expect(document.head.querySelector('link[rel="canonical"]')).toHaveAttribute(
      "href",
      "https://rethinkloop.com/ideas/independent-cafe-ideas/prep-forecast-id",
    )
  })

  it("shows a terminal selection failure on the idea detail page", () => {
    render(
      <MemoryRouter>
        <IdeaDetailView
          ideaId="prep-forecast-id"
          jobSlug="generated-ideas"
          jobTitle="Generated ideas"
          numberOfIdeas={1}
          run={{
            status: "failed",
            failedStage: "selection",
            researchPromptStreamId: "planning",
            research: [],
            researchSummaryStreamId: "summary",
            ideaGenerationStreamId: "ideas",
            ideas: [
              {
                ideaId: "prep-forecast-id",
                title: "Prep Forecast",
                description: "Recommend daily prep quantities.",
                selection: "pending",
              },
            ],
            critiqueGenerationStreamIds: {},
            ideaSelectionStreamId: "selection",
            refinementGenerationStreamIds: {},
            refinedIdeas: {},
            refinedIdeaResearch: {},
            error: "Selection failed",
          }}
        />
      </MemoryRouter>,
    )

    expect(
      screen.getByText("Selection did not complete for this idea."),
    ).toBeVisible()
    expect(screen.getByText("Selection incomplete")).toBeVisible()
    expect(screen.queryByText("Awaiting selection")).not.toBeInTheDocument()
    expect(
      screen.queryByText(
        "Selection starts after every idea has been critiqued…",
      ),
    ).not.toBeInTheDocument()
  })

  it("marks an unfinished refinement as failed instead of improving", () => {
    render(
      <MemoryRouter>
        <IdeaJobView
          jobSlug="generated-ideas"
          prompt="Generate ideas"
          title="Generated ideas"
          run={{
            status: "failed",
            failedStage: "refinement",
            researchPromptStreamId: "planning",
            research: [],
            researchSummaryStreamId: "summary",
            ideaGenerationStreamId: "ideas",
            ideas: [
              {
                ideaId: "prep-forecast-id",
                title: "Prep Forecast",
                description: "Recommend daily prep quantities.",
                selection: "selected",
              },
            ],
            critiqueGenerationStreamIds: {},
            ideaSelectionStreamId: "selection",
            refinementGenerationStreamIds: {
              "prep-forecast-id": "prep-refinement",
            },
            refinedIdeas: {},
            refinedIdeaResearch: {},
            error: "Refinement failed",
          }}
        />
      </MemoryRouter>,
    )

    expect(screen.getByText("Improvement failed")).toBeVisible()
    expect(screen.queryByText("Improving")).not.toBeInTheDocument()
  })

  it("reconnects and replays when a job stream ends before done", async () => {
    mocks.subscribeToIdeaJob
      .mockImplementationOnce(async function* () {
        await Promise.resolve()
        yield* []
      })
      .mockImplementationOnce(async function* () {
        await Promise.resolve()
        yield { type: "done" as const }
      })

    renderIdeas("/ideas/idea-job-id")

    expect(
      await screen.findByText(
        "Live updates were interrupted. Reconnecting…",
      ),
    ).toBeVisible()
    await waitFor(() =>
      expect(mocks.subscribeToIdeaJob).toHaveBeenCalledTimes(2),
    )
    expect(
      screen.queryByText("Live updates were interrupted. Reconnecting…"),
    ).not.toBeInTheDocument()
  })

  it("lists previous jobs with consistent status labels", async () => {
    mocks.getIdeaJobs.mockResolvedValue([
      {
        ideaJobId: "previous-idea-job",
        title: "Previously Generated Ideas",
        slug: "previously-generated-ideas",
        prompt: "Previously generated ideas",
        numberOfIdeas: 12,
        deepSearchCount: 2,
        stage: "ideas",
        status: "completed",
        error: null,
        createdAt: new Date("2026-08-04T12:00:00.000Z"),
        completedAt: new Date("2026-08-04T12:30:00.000Z"),
      },
    ])

    renderIdeas()

    expect(
      await screen.findByRole("link", { name: /Previously Generated Ideas/ }),
    ).toHaveAttribute("href", "/ideas/previously-generated-ideas")
    expect(screen.getByText("Complete")).toBeVisible()
  })
})
