import {
  fireEvent,
  render,
  screen,
  waitFor,
  within,
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
      screen.getByText("Recommend daily prep quantities from recent demand."),
    ).toBeVisible()
    const ideaCard = screen.getByRole("article", { name: "Prep Forecast" })
    expect(await within(ideaCard).findByTestId("idea-critique-0")).toHaveTextContent(
      "critique text",
    )
    expect(screen.getByRole("status")).toHaveTextContent(
      "Critique for Prep Forecast: Response complete",
    )
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

  it("nests each completed critique inside its idea card", async () => {
    mocks.subscribeToTextStream.mockImplementation(async function* (id: string) {
      await Promise.resolve()
      yield { type: "reasoning" as const, text: "Critique reasoning" }
      yield { type: "text" as const, text: `Response from ${id}` }
      yield { type: "done" as const }
    })
    render(
      <IdeaJobView
        title="Generated ideas"
        prompt="Generate ideas"
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
              description: "Recommend daily prep quantities from recent demand.",
              selection: "selected",
            },
            {
              ideaId: "closing-bundles-id",
              title: "Closing Bundles",
              description: "Bundle likely leftovers before closing time.",
              selection: "rejected",
            },
          ],
          critiqueGenerationStreamIds: {
            0: "prep-critique",
            1: "bundle-critique",
          },
          ideaSelectionStreamId: "selection",
          refinementGenerationStreamIds: {},
          refinedIdeas: {},
          refinedIdeaResearch: {},
          error: null,
        }}
      />,
    )

    expect(
      screen.getByRole("button", { name: /Generate ideas Complete/ }),
    ).toHaveAttribute("aria-expanded", "true")
    const prepCard = screen.getByRole("article", { name: "Prep Forecast" })
    const bundleCard = screen.getByRole("article", { name: "Closing Bundles" })
    expect(await within(prepCard).findByTestId("idea-critique-0")).toHaveTextContent(
      "Response from prep-critique",
    )
    expect(
      await within(bundleCard).findByTestId("idea-critique-1"),
    ).toHaveTextContent("Response from bundle-critique")
    expect(within(prepCard).queryByTestId("idea-critique-1")).not.toBeInTheDocument()
    expect(within(bundleCard).queryByTestId("idea-critique-0")).not.toBeInTheDocument()
    expect(within(prepCard).getByText("Selected idea")).toBeVisible()
    expect(within(bundleCard).getByText("Not selected")).toBeVisible()
    expect(await screen.findByTestId("idea-selection")).toBeVisible()
    expect(screen.getByText("1 idea selected.")).toBeVisible()
    expect(
      screen.queryByRole("button", { name: /Critique each idea/ }),
    ).not.toBeInTheDocument()
    expect(screen.queryByText("Raw structured output")).not.toBeInTheDocument()
  })

  it("shows the original, improved idea, and its completed research inline", async () => {
    mocks.subscribeToDeepSearchJob.mockImplementation(async function* (
      _id: string,
      _signal?: AbortSignal,
      onOpen?: () => void,
    ) {
      await Promise.resolve()
      onOpen?.()
      yield { type: "final-answer-stream" as const, streamId: "idea-answer" }
      yield { type: "done" as const }
    })
    mocks.subscribeToTextStream.mockImplementation(async function* (id: string) {
      await Promise.resolve()
      yield { type: "reasoning" as const, text: "Research reasoning" }
      yield {
        type: "text" as const,
        text:
          id === "idea-answer"
            ? "Evidence supports a confidence-aware pilot."
            : `Response from ${id}`,
      }
      yield { type: "done" as const }
    })

    render(
      <MemoryRouter>
        <IdeaJobView
          title="Generated ideas"
          prompt="Generate ideas"
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
            critiqueGenerationStreamIds: {},
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
      screen.getByRole("button", {
        name: /Improve and research selected ideas Complete/,
      }),
    ).toBeVisible()
    const card = screen.getByRole("article", {
      name: "Confidence-Aware Prep Forecast",
    })
    expect(within(card).queryByText("Selected idea")).not.toBeInTheDocument()
    expect(within(card).getByText("Prep Forecast")).toBeVisible()
    expect(
      within(card).getByText(
        "Recommend prep ranges with confidence and staff overrides.",
      ),
    ).toBeVisible()
    await waitFor(() =>
      expect(
        within(card).getByTestId("idea-research-prep-research"),
      ).toHaveTextContent("Evidence supports a confidence-aware pilot."),
    )
    expect(
      within(card).getByRole("link", { name: "Open full research" }),
    ).toHaveAttribute("href", "/deep-search/confidence-aware-prep-forecast")
  })

  it("shows persisted ideas before their critique calls start", () => {
    render(
      <IdeaJobView
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
      />,
    )

    expect(
      screen.getByRole("button", { name: /Generate ideas Complete/ }),
    ).toBeVisible()
    const ideaCard = screen.getByRole("article", { name: "Prep Forecast" })
    expect(within(ideaCard).getByText("Critique pending…")).toBeVisible()
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

  it("marks generated ideas complete when critique creation fails", () => {
    render(
      <IdeaJobView
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
      />,
    )

    expect(
      screen.getByRole("button", { name: /Generate ideas Complete/ }),
    ).toBeVisible()
    const ideaCard = screen.getByRole("article", { name: "Prep Forecast" })
    expect(
      within(ideaCard).getByText("Critique did not start for this idea."),
    ).toBeVisible()
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
