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
          <Route path="/ideas/:ideaJobId" element={<Ideas />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  )
}

describe("Ideas", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.getIdeaJobs.mockResolvedValue([])
    mocks.createIdeaJob.mockResolvedValue("idea-job-id")
    mocks.getIdeaJob.mockResolvedValue({
      ideaJobId: "idea-job-id",
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
        researchRequest: "Research café waste causes",
      }
      yield {
        type: "deep-search-started" as const,
        deepSearchJobId: "search-two",
        researchRequest: "Research proven café interventions",
      }
      yield { type: "research-summary-stream" as const, streamId: "summary" }
      yield { type: "idea-generation-stream" as const, streamId: "ideas" }
      yield {
        type: "idea" as const,
        title: "Prep Forecast",
        description: "Recommend daily prep quantities from recent demand.",
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
    fireEvent.change(
      screen.getByLabelText("What should we generate ideas for?"),
      { target: { value: "Ideas for independent cafés" } },
    )
    fireEvent.click(screen.getByRole("button", { name: "Generate 12 ideas" }))

    expect(await screen.findByText("Prep Forecast")).toBeVisible()
    expect(
      screen.getByText("Recommend daily prep quantities from recent demand."),
    ).toBeVisible()
    expect(screen.getAllByRole("status")).toHaveLength(1)
    expect(screen.getByRole("status")).toHaveTextContent(
      "Idea generation: Response complete",
    )
    await waitFor(() =>
      expect(screen.getByTestId("idea-generation")).toHaveTextContent(
        "Prep Forecast",
      ),
    )
    expect(mocks.createIdeaJob).toHaveBeenCalledWith({
      prompt: "Ideas for independent cafés",
    })
    fireEvent.click(
      screen.getByRole("button", { name: /Deep research Complete/ }),
    )
    expect(
      screen.getByRole("link", { name: "Research café waste causes" }),
    ).toHaveAttribute("href", "/deep-search/search-one")
    expect(
      screen.getByRole("link", { name: "Research café waste causes" }),
    ).toHaveAttribute("target", "_blank")
    expect(
      screen.getByRole("link", {
        name: "Research proven café interventions",
      }),
    ).toHaveAttribute("href", "/deep-search/search-two")

    const output = screen
      .getByText("Raw structured output")
      .closest(".MuiPaper-root")
    if (!(output instanceof HTMLElement)) {
      throw new Error("Raw idea output was not rendered")
    }
    const reasoning = within(output).getByRole("button", {
      name: "Show reasoning",
    })
    fireEvent.click(reasoning)
    expect(screen.getByText("Reasoning for ideas")).toBeVisible()
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
        prompt="Generate ideas"
        run={{
          status: "failed",
          failedStage: "planning",
          researchPromptStreamId: "planning",
          research: [],
          researchSummaryStreamId: null,
          ideaGenerationStreamId: null,
          ideas: [],
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
        prompt="Generate ideas"
        run={{
          status: "failed",
          failedStage: "ideas",
          researchPromptStreamId: "planning",
          research: [],
          researchSummaryStreamId: "summary",
          ideaGenerationStreamId: null,
          ideas: [],
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
      await screen.findByRole("link", { name: /Previously generated ideas/ }),
    ).toHaveAttribute("href", "/ideas/previous-idea-job")
    expect(screen.getByText("Complete")).toBeVisible()
  })
})
