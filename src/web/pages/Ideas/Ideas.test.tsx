import {
  act,
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
  requestResearchResume: vi.fn(),
  requestResearchStop: vi.fn(),
  subscribeToDeepSearchJob: vi.fn(),
  subscribeToIdeaJob: vi.fn(),
  subscribeToTextStream: vi.fn(),
  updateResultFeedback: vi.fn(),
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

vi.mock("../../lib/researchCancellation.ts", () => ({
  requestResearchStop: mocks.requestResearchStop,
}))

vi.mock("../../lib/researchResumption.ts", () => ({
  requestResearchResume: mocks.requestResearchResume,
}))

vi.mock("../../lib/resultFeedback.ts", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../lib/resultFeedback.ts")>()),
  updateResultFeedback: mocks.updateResultFeedback,
}))

import { Ideas } from "./index.tsx"
import { IdeaDetailView } from "./components/IdeaDetailView.tsx"
import { IdeaJobView } from "./components/IdeaJobView.tsx"
import { initialIdeaJobState } from "./ideaJobState.ts"

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
    mocks.requestResearchStop.mockResolvedValue({
      status: "cancellation-requested",
      cancelRequestedAt: new Date(),
    })
    mocks.requestResearchResume.mockResolvedValue({ status: "running" })
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
      stopRequested: false,
      canResume: false,
      canStop: true,
      error: null,
      creditsUsed: null,
      feedback: null,
      createdAt: new Date(),
      completedAt: null,
    })
    mocks.updateResultFeedback.mockResolvedValue({
      rating: false,
      hasWrittenFeedback: false,
    })
  })

  it("refetches a running parent after done, shows its cost, and omits feedback from an idea page", async () => {
    const runningJob = {
      ideaJobId: "idea-job-id",
      title: "Independent Café Ideas",
      slug: "independent-cafe-ideas",
      prompt: "Ideas for independent cafés",
      numberOfIdeas: 12,
      deepSearchCount: 2,
      isIndexable: false,
      isPublic: false,
      stage: "ideas",
      status: "running",
      stopRequested: false,
      canStop: true,
      error: null,
      creditsUsed: null,
      feedback: { rating: null, hasWrittenFeedback: false },
      createdAt: new Date(),
      completedAt: null,
    } as const
    mocks.getIdeaJob
      .mockResolvedValueOnce(runningJob)
      .mockResolvedValue({
        ...runningJob,
        status: "completed",
        canStop: false,
        completedAt: new Date(),
        creditsUsed: 654,
      })
    mocks.subscribeToIdeaJob.mockImplementation(async function* () {
      await Promise.resolve()
      yield { type: "done" as const }
    })

    const parent = renderIdeas("/ideas/independent-cafe-ideas")
    expect(
      await screen.findByRole("button", { name: "Thumbs down" }),
    ).toBeVisible()
    expect(screen.getByText("654 credits")).toBeVisible()
    await waitFor(() => expect(mocks.getIdeaJob).toHaveBeenCalledTimes(2))
    parent.unmount()

    renderIdeas("/ideas/independent-cafe-ideas/missing-idea")
    await waitFor(() => expect(mocks.getIdeaJob).toHaveBeenCalled())
    expect(
      screen.queryByRole("button", { name: "Thumbs down" }),
    ).not.toBeInTheDocument()
  })

  it("explains how to generate researched options", async () => {
    renderIdeas()

    expect(
      screen.getByRole("heading", { level: 1, name: "Generate options" }),
    ).toBeVisible()
    expect(
      screen.getByText(
        "Describe the question, goal, or constraints. You’ll get multiple researched options to review.",
      ),
    ).toBeVisible()
    expect(
      screen.getByLabelText("Question, goal, or constraints"),
    ).toBeVisible()
    expect(
      screen.getByRole("button", { name: "Generate options" }),
    ).toBeDisabled()
    expect(
      await screen.findByRole("heading", { name: "Previous option runs" }),
    ).toBeVisible()
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
    const submit = screen.getByRole("button", { name: "Generate options" })
    expect(submit).toBeDisabled()
    fireEvent.change(
      screen.getByLabelText("Question, goal, or constraints"),
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
    expect(ideaLink).not.toHaveAttribute("target")
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

  it("confirms and requests Stop only for a stoppable standalone run", async () => {
    async function* runningEvents() {
      yield { type: "research-prompt-stream" as const, streamId: "planning" }
      await new Promise(() => undefined)
    }
    mocks.subscribeToIdeaJob.mockImplementation(runningEvents)

    renderIdeas("/ideas/independent-cafe-ideas")

    fireEvent.click(
      await screen.findByRole("button", { name: "Stop workflow" }),
    )
    expect(
      screen.getByRole("heading", { name: "Stop this workflow?" }),
    ).toBeVisible()
    fireEvent.click(
      screen.getByRole("button", { name: "Stop workflow" }),
    )

    await waitFor(() => {
      expect(mocks.requestResearchStop).toHaveBeenCalledWith(
        "idea",
        "idea-job-id",
      )
    })
    expect(
      await screen.findByRole("button", { name: "Stopping…" }),
    ).toBeDisabled()
    expect(screen.queryByRole("progressbar")).not.toBeInTheDocument()
  })

  it.each(["failed", "interrupted"] as const)(
    "resumes a %s root and reconnects the same job stream",
    async (status) => {
      mocks.getIdeaJob.mockResolvedValue({
        ...(await mocks.getIdeaJob()),
        canResume: true,
        canStop: false,
        completedAt: new Date(),
        error: "Option generation stopped unexpectedly",
        status,
      })
      mocks.subscribeToIdeaJob
        .mockImplementationOnce(async function* () {
          await Promise.resolve()
          if (status === "failed") {
            yield {
              type: "error" as const,
              message: "Option generation stopped unexpectedly",
              stage: "planning" as const,
            }
          } else {
            yield {
              type: "interrupted" as const,
              message: "Option generation stopped unexpectedly",
            }
          }
          yield { type: "done" as const }
        })
        .mockImplementationOnce(async function* (
          _jobId: string,
          signal?: AbortSignal,
        ) {
          yield {
            type: "research-prompt-stream" as const,
            streamId: "resumed-planning",
          }
          await new Promise<void>((resolve) => {
            if (signal?.aborted) resolve()
            else
              signal?.addEventListener("abort", () => resolve(), {
                once: true,
              })
          })
        })

      renderIdeas("/ideas/independent-cafe-ideas")

      fireEvent.click(
        await screen.findByRole("button", { name: "Resume workflow" }),
      )

      await waitFor(() =>
        expect(mocks.requestResearchResume).toHaveBeenCalledWith(
          "idea",
          "idea-job-id",
        ),
      )
      await waitFor(() =>
        expect(mocks.subscribeToIdeaJob).toHaveBeenCalledTimes(2),
      )
      expect(mocks.subscribeToIdeaJob).toHaveBeenLastCalledWith(
        "idea-job-id",
        expect.any(AbortSignal),
        expect.any(Function),
      )
      expect(
        screen.queryByRole("button", { name: "Resume workflow" }),
      ).not.toBeInTheDocument()
      expect(
        screen.getByRole("button", { name: "Stop workflow" }),
      ).toBeEnabled()
      expect(
        screen.getByText(
          "Follow the current stage or expand an earlier stage for details.",
        ),
      ).toBeVisible()
    },
  )

  it("keeps Resume off nested idea routes", async () => {
    mocks.getIdeaJob.mockResolvedValue({
      ...(await mocks.getIdeaJob()),
      canResume: true,
      canStop: false,
      error: "Option generation stopped unexpectedly",
      status: "failed",
    })

    renderIdeas("/ideas/independent-cafe-ideas/missing-idea")

    await waitFor(() => expect(mocks.getIdeaJob).toHaveBeenCalled())
    expect(
      screen.queryByRole("button", { name: "Resume workflow" }),
    ).not.toBeInTheDocument()
  })

  it.each([
    [false, true],
    [true, false],
  ] as const)(
    "restores durable stopping for isPublic=%s with ownerControl=%s",
    async (isPublic, ownerControl) => {
      mocks.getIdeaJob.mockResolvedValue({
        ...(await mocks.getIdeaJob()),
        canStop: false,
        isPublic,
        stopRequested: true,
      })
      mocks.subscribeToIdeaJob.mockImplementation(async function* (
        _jobId: string,
        signal?: AbortSignal,
      ) {
        yield { type: "stop-requested" as const }
        await new Promise<void>((resolve) => {
          if (signal?.aborted) resolve()
          else signal?.addEventListener("abort", () => resolve(), { once: true })
        })
      })

      renderIdeas("/ideas/independent-cafe-ideas")

      expect(
        await screen.findByText("Stopping queued and active work…"),
      ).toBeVisible()
      const stoppingControls = screen.queryAllByRole("button", {
        name: "Stopping…",
      })
      expect(stoppingControls).toHaveLength(ownerControl ? 1 : 0)
      expect(
        stoppingControls.every((control) => control.hasAttribute("disabled")),
      ).toBe(true)
    },
  )

  it.each([
    [true, "Stopped", "This run was stopped. Completed work remains available below."],
    [false, "Interrupted", "This run was interrupted. Completed work remains available below."],
  ] as const)(
    "distinguishes stopped=%s from restart interruption",
    (stopRequested, label, description) => {
      render(
        <IdeaJobView
          jobSlug="generated-ideas"
          prompt="Generate ideas"
          title="Generated ideas"
          stopRequested={stopRequested}
          run={{
            status: "interrupted",
            failedStage: null,
            researchPromptStreamId: null,
            research: [],
            researchSummaryStreamId: null,
            ideaGenerationStreamId: null,
            ideas: [],
            ideaEvaluations: {},
            ideaSelectionStreamId: null,
            refinementGenerationStreamIds: {},
            refinedIdeas: {},
            refinedIdeaResearch: {},
            error: "Workflow ended",
          }}
        />,
      )

      expect(screen.getByText(label)).toBeVisible()
      expect(screen.getByText(description)).toBeVisible()
    },
  )

  it.each([
    [true, "Stopped"],
    [false, "Interrupted"],
  ] as const)(
    "distinguishes stopped=%s on an individual idea URL",
    (stopRequested, label) => {
      render(
        <MemoryRouter>
          <IdeaDetailView
            ideaId="prep-forecast-id"
            jobSlug="generated-ideas"
            jobTitle="Generated ideas"
            numberOfIdeas={1}
            stopRequested={stopRequested}
            run={{
              status: "interrupted",
              failedStage: null,
              researchPromptStreamId: null,
              research: [],
              researchSummaryStreamId: null,
              ideaGenerationStreamId: null,
              ideas: [
                {
                  ideaId: "prep-forecast-id",
                  title: "Prep Forecast",
                  description: "Recommend daily prep quantities.",
                  selection: "pending",
                },
              ],
              ideaEvaluations: {},
              ideaSelectionStreamId: null,
              refinementGenerationStreamIds: {},
              refinedIdeas: {},
              refinedIdeaResearch: {},
              error: "Workflow ended",
            }}
          />
        </MemoryRouter>,
      )

      expect(screen.getAllByText(label).length).toBeGreaterThan(0)
      expect(screen.queryByRole("progressbar")).not.toBeInTheDocument()
    },
  )

  it("shows an unselected idea without a stale assessment", () => {
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
                selection: "rejected",
              },
            ],
            ideaEvaluations: {
              "prep-forecast-id": {
                pros: [
                  "Fits the morning preparation workflow.",
                  "Produces a concrete daily recommendation.",
                ],
                cons: [
                  "Depends on clean till data.",
                  "Staff may distrust hidden uncertainty.",
                ],
                critique:
                  "A useful concept that needs confidence ranges and staff overrides.",
              },
            },
            ideaSelectionStreamId: "selection",
            refinementGenerationStreamIds: {},
            refinedIdeas: {},
            refinedIdeaResearch: {},
            error: null,
          }}
        />
      </MemoryRouter>,
    )

    expect(screen.getAllByText("Prep Forecast")).toHaveLength(1)
    expect(
      screen.getByRole("heading", { level: 2, name: "Original idea" }),
    ).toBeVisible()
    expect(screen.getByText("Recommend fixed prep quantities.")).toBeVisible()
    expect(screen.queryByTestId("idea-assessment-0")).not.toBeInTheDocument()
    expect(
      screen.queryByRole("button", { name: "How this idea was developed" }),
    ).not.toBeInTheDocument()
  })

  it("presents a refined draft as researching, assessing, then incomplete", () => {
    const draftRun = {
      ...initialIdeaJobState,
      status: "running" as const,
      ideas: [
        {
          ideaId: "prep-forecast-id",
          title: "Prep Forecast",
          description: "Recommend fixed prep quantities.",
          selection: "selected" as const,
        },
      ],
      refinementGenerationStreamIds: {
        "prep-forecast-id": "prep-refinement",
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
    }
    const { rerender } = render(
      <MemoryRouter>
        <IdeaDetailView
          ideaId="prep-forecast-id"
          jobSlug="generated-ideas"
          jobTitle="Generated ideas"
          numberOfIdeas={1}
          run={draftRun}
        />
      </MemoryRouter>,
    )

    expect(screen.getByText("Researching improved idea")).toBeVisible()
    expect(
      screen.getByRole("heading", { name: "Improved idea draft" }),
    ).toBeVisible()
    expect(screen.getByText(/This is a provisional draft/)).toBeVisible()
    expect(
      screen.getByText(/Supporting research is in progress/),
    ).toBeVisible()
    expect(screen.queryByText("Improved")).not.toBeInTheDocument()

    rerender(
      <MemoryRouter>
        <IdeaDetailView
          ideaId="prep-forecast-id"
          jobSlug="generated-ideas"
          jobTitle="Generated ideas"
          numberOfIdeas={1}
          run={{
            ...draftRun,
            ideaEvaluationStreamIds: {
              "prep-forecast-id": "prep-evaluation",
            },
          }}
        />
      </MemoryRouter>,
    )

    expect(screen.getByText("Assessing improved idea")).toBeVisible()
    expect(
      screen.getByText(/Supporting research is complete and available/),
    ).toBeVisible()
    expect(screen.getByText("Assessing this improved idea…")).toBeVisible()

    rerender(
      <MemoryRouter>
        <IdeaDetailView
          ideaId="prep-forecast-id"
          jobSlug="generated-ideas"
          jobTitle="Generated ideas"
          numberOfIdeas={1}
          run={{
            ...draftRun,
            status: "interrupted",
            ideaEvaluationStreamIds: {
              "prep-forecast-id": "prep-evaluation",
            },
          }}
        />
      </MemoryRouter>,
    )

    expect(screen.getByText("Assessment incomplete")).toBeVisible()
    expect(screen.queryByRole("progressbar")).not.toBeInTheDocument()
    expect(screen.queryByText("Improved")).not.toBeInTheDocument()
  })

  it("completes supporting research before assessments enter the queue", () => {
    const run = {
      ...initialIdeaJobState,
      status: "running" as const,
      ideas: [
        {
          ideaId: "first-idea",
          title: "First original",
          description: "First original description.",
          selection: "selected" as const,
        },
        {
          ideaId: "queued-idea",
          title: "Queued original",
          description: "Queued original description.",
          selection: "selected" as const,
        },
      ],
      ideaSelectionStreamId: "selection",
      refinementGenerationStreamIds: {
        "first-idea": "first-refinement",
        "queued-idea": "queued-refinement",
      },
      refinedIdeas: {
        "first-idea": {
          ideaId: "first-idea",
          title: "First draft",
          description: "First draft description.",
        },
        "queued-idea": {
          ideaId: "queued-idea",
          title: "Queued draft",
          description: "Queued draft description.",
        },
      },
      refinedIdeaResearch: {
        "first-idea": {
          deepSearchJobId: "first-research",
          title: "First draft",
          slug: "first-draft",
          researchRequest: "Research the first draft.",
        },
        "queued-idea": {
          deepSearchJobId: "queued-research",
          title: "Queued draft",
          slug: "queued-draft",
          researchRequest: "Research the queued draft.",
        },
      },
      refinedIdeaResearchCompleted: true,
      ideaEvaluationStreamIds: {},
    }
    const { rerender } = render(
      <MemoryRouter>
        <IdeaDetailView
          ideaId="queued-idea"
          jobSlug="generated-ideas"
          jobTitle="Generated ideas"
          numberOfIdeas={2}
          run={run}
        />
      </MemoryRouter>,
    )

    expect(screen.getByText("Waiting for assessment")).toBeVisible()
    expect(
      screen.getByText(/Supporting research is complete and available/),
    ).toBeVisible()
    expect(
      screen.getByText(/Waiting for this improved idea's assessment to start/),
    ).toBeVisible()

    rerender(
      <MemoryRouter>
        <IdeaJobView
          jobSlug="generated-ideas"
          prompt="Generate ideas"
          title="Generated ideas"
          run={run}
        />
      </MemoryRouter>,
    )

    expect(
      screen.getByRole("button", { name: /Research improved ideas Complete/ }),
    ).toBeVisible()
    expect(
      screen.getByRole("button", { name: /Assess improved ideas Waiting/ }),
    ).toBeVisible()
    expect(screen.getByText("Waiting to assess the improved ideas…")).toBeVisible()

    rerender(
      <MemoryRouter>
        <IdeaJobView
          jobSlug="generated-ideas"
          prompt="Generate ideas"
          title="Generated ideas"
          run={{
            ...run,
            ideaEvaluationStreamIds: { "first-idea": "first-evaluation" },
          }}
        />
      </MemoryRouter>,
    )

    expect(
      screen.getByRole("button", { name: /Assess improved ideas Running/ }),
    ).toBeVisible()
  })

  it("keeps completed supporting research available when assessment setup fails", () => {
    render(
      <MemoryRouter>
        <IdeaDetailView
          ideaId="prep-forecast-id"
          jobSlug="generated-ideas"
          jobTitle="Generated ideas"
          numberOfIdeas={1}
          run={{
            ...initialIdeaJobState,
            status: "failed",
            failedStage: "evaluation",
            ideas: [
              {
                ideaId: "prep-forecast-id",
                title: "Prep Forecast",
                description: "Recommend fixed prep quantities.",
                selection: "selected",
              },
            ],
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
            error: "Evaluation failed before streaming",
          }}
        />
      </MemoryRouter>,
    )

    expect(
      screen.getByText(/Supporting research is complete and available/),
    ).toBeVisible()
    expect(screen.getByText("Assessment failed")).toBeVisible()
  })

  it("shows one stable idea list without an empty selection rationale", () => {
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
          ideaEvaluations: {},
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
            "demand-signals-id": {
              ideaId: "demand-signals-id",
              title: "Actionable Demand Signals",
              description: "Turn local signals into clear preparation advice.",
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

    const ideaStage = screen.getByRole("button", {
      name: /Generate ideas Complete/,
    })
    expect(ideaStage).toHaveAttribute("aria-expanded", "false")
    const improvementStage = screen.getByRole("button", {
      name: /Research improved ideas Running/,
    })
    expect(improvementStage).toHaveAttribute("aria-expanded", "true")
    const progressStages = screen.getByRole("group", {
      name: "Idea generation stages",
    })
    expect(
      improvementStage.closest("h3")?.parentElement?.parentElement,
    ).toBe(progressStages)
    fireEvent.click(ideaStage)
    expect(ideaStage).toHaveAttribute("aria-expanded", "true")
    fireEvent.click(
      screen.getByRole("button", { name: /Select ideas Complete/ }),
    )
    const ideasHeading = screen.getByRole("heading", {
      level: 2,
      name: "Ideas",
    })
    const progressHeading = screen.getByRole("heading", {
      level: 2,
      name: "Progress",
    })
    expect(
      ideasHeading.compareDocumentPosition(progressHeading) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy()
    expect(
      screen.getByRole("link", {
        name: "View Confidence-Aware Prep Forecast",
      }),
    ).toHaveAttribute("href", "/ideas/generated-ideas/prep-forecast-id")
    expect(screen.getByRole("link", { name: "View Closing Bundles" })).toHaveAttribute(
      "href",
      "/ideas/generated-ideas/closing-bundles-id",
    )
    expect(
      screen.getByRole("link", { name: "View Actionable Demand Signals" }),
    ).toHaveAttribute("href", "/ideas/generated-ideas/demand-signals-id")
    expect(
      screen.queryByRole("link", { name: "View selected Prep Forecast" }),
    ).not.toBeInTheDocument()
    expect(
      screen.queryByRole("link", {
        name: "View improved Confidence-Aware Prep Forecast",
      }),
    ).not.toBeInTheDocument()
    expect(screen.getByText("Not selected")).toBeVisible()
    expect(screen.getAllByText("Researching improved idea")).toHaveLength(2)
    expect(screen.queryByText("Improved")).not.toBeInTheDocument()
    expect(screen.queryByText("Improving")).not.toBeInTheDocument()
    expect(screen.queryByTestId("idea-selection")).not.toBeInTheDocument()
    expect(mocks.subscribeToTextStream).not.toHaveBeenCalledWith(
      "selection",
      expect.anything(),
      expect.anything(),
    )
    expect(screen.queryByText("Response from selection")).not.toBeInTheDocument()
    expect(screen.queryByText("Selection reasoning")).not.toBeInTheDocument()
    expect(
      screen.getByText("2 of 3 ideas selected for improvement."),
    ).toBeVisible()
    expect(
      screen.getByRole("button", { name: /Select ideas Complete/ }),
    ).toBeVisible()
    expect(screen.queryByText("Raw structured output")).not.toBeInTheDocument()
  })

  it("keeps the candidate list first and preserves its nodes through selection and refinement", () => {
    const initialRun = {
      status: "running" as const,
      failedStage: null,
      researchPromptStreamId: null,
      research: [],
      researchSummaryStreamId: null,
      ideaGenerationStreamId: "ideas",
      ideas: [
        {
          ideaId: "prep-forecast-id",
          title: "Prep Forecast",
          description: "Recommend daily prep quantities.",
          selection: "pending" as const,
        },
        {
          ideaId: "closing-bundles-id",
          title: "Closing Bundles",
          description: "Bundle likely leftovers.",
          selection: "pending" as const,
        },
      ],
      ideaEvaluations: {},
      ideaSelectionStreamId: null,
      refinementGenerationStreamIds: {},
      refinedIdeas: {},
      refinedIdeaResearch: {},
      error: null,
    }
    const { rerender } = render(
      <MemoryRouter>
        <IdeaJobView
          jobSlug="generated-ideas"
          prompt="Generate ideas"
          title="Generated ideas"
          run={initialRun}
        />
      </MemoryRouter>,
    )

    const resultsHeading = screen.getByRole("heading", {
      level: 2,
      name: "Ideas",
    })
    const processHeading = screen.getByRole("heading", {
      level: 2,
      name: "Progress",
    })
    expect(
      resultsHeading.compareDocumentPosition(processHeading) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy()

    const originalLink = screen.getByRole("link", {
      name: "View Prep Forecast",
    })
    const originalCard = originalLink.closest("li")
    const ideaStage = screen.getByRole("button", {
      name: /Generate ideas Running/,
    })
    fireEvent.click(ideaStage)
    fireEvent.click(ideaStage)
    act(() => originalLink.focus())

    rerender(
      <MemoryRouter>
        <IdeaJobView
          jobSlug="generated-ideas"
          prompt="Generate ideas"
          title="Generated ideas"
          run={{
            ...initialRun,
            ideas: [
              { ...initialRun.ideas[0], selection: "selected" },
              { ...initialRun.ideas[1], selection: "rejected" },
            ],
            ideaEvaluations: {
              "prep-forecast-id": {
                pros: ["Practical"],
                cons: ["Needs data"],
                critique: "Worth improving.",
              },
              "closing-bundles-id": {
                pros: ["Simple"],
                cons: ["Limited upside"],
                critique: "Lower potential.",
              },
            },
            ideaSelectionStreamId: "selection",
            refinementGenerationStreamIds: {
              "prep-forecast-id": "refinement",
            },
            refinedIdeas: {
              "prep-forecast-id": {
                ideaId: "prep-forecast-id",
                title: "Confidence-Aware Prep Forecast",
                description: "Recommend prep ranges with confidence.",
              },
            },
          }}
        />
      </MemoryRouter>,
    )

    const updatedLink = screen.getByRole("link", {
      name: "View Confidence-Aware Prep Forecast",
    })
    expect(updatedLink.closest("li")).toBe(originalCard)
    expect(updatedLink).toHaveFocus()
    expect(screen.getByRole("link", { name: "View Closing Bundles" })).toBeVisible()
    expect(
      screen.getByText("1 of 2 ideas selected for improvement."),
    ).toBeVisible()
    expect(
      screen.getByRole("button", {
        name: /Generate ideas Complete/,
      }),
    ).toHaveAttribute("aria-expanded", "true")

    rerender(
      <MemoryRouter>
        <IdeaJobView
          jobSlug="generated-ideas"
          prompt="Generate ideas"
          title="Generated ideas"
          run={{
            ...initialRun,
            status: "completed",
            ideas: [
              { ...initialRun.ideas[0], selection: "selected" },
              { ...initialRun.ideas[1], selection: "rejected" },
            ],
            ideaEvaluations: {
              "prep-forecast-id": {
                pros: ["Practical"],
                cons: ["Needs data"],
                critique: "Worth improving.",
              },
              "closing-bundles-id": {
                pros: ["Simple"],
                cons: ["Limited upside"],
                critique: "Lower potential.",
              },
            },
            ideaSelectionStreamId: "selection",
            refinementGenerationStreamIds: {
              "prep-forecast-id": "refinement",
            },
            refinedIdeas: {
              "prep-forecast-id": {
                ideaId: "prep-forecast-id",
                title: "Confidence-Aware Prep Forecast",
                description: "Recommend prep ranges with confidence.",
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
          }}
        />
      </MemoryRouter>,
    )

    const completedLink = screen.getByRole("link", {
      name: "View Confidence-Aware Prep Forecast",
    })
    expect(completedLink.closest("li")).toBe(originalCard)
    expect(completedLink).toHaveFocus()
    expect(
      screen.queryByRole("button", {
        name: /Refine selected ideas/,
      }),
    ).not.toBeInTheDocument()
  })

  it("does not expose or subscribe to deferred idea-selection rationale", () => {
    mocks.subscribeToTextStream.mockImplementation(async function* () {
      await Promise.resolve()
      yield { type: "done" as const }
    })

    render(
      <MemoryRouter>
        <IdeaJobView
          jobSlug="generated-ideas"
          prompt="Generate ideas"
          title="Generated ideas"
          run={{
            status: "completed",
            failedStage: null,
            researchPromptStreamId: null,
            research: [],
            researchSummaryStreamId: null,
            ideaGenerationStreamId: "ideas",
            ideas: [
              {
                ideaId: "prep-forecast-id",
                title: "Prep Forecast",
                description: "Recommend daily prep quantities.",
                selection: "selected",
              },
            ],
            ideaEvaluations: {},
            ideaSelectionStreamId: "selection-rationale",
            refinementGenerationStreamIds: {},
            refinedIdeas: {},
            refinedIdeaResearch: {},
            error: null,
          }}
        />
      </MemoryRouter>,
    )

    expect(
      screen.queryByText("Why these ideas were selected"),
    ).not.toBeInTheDocument()
    expect(screen.queryByText("Selection reasoning")).not.toBeInTheDocument()
    expect(mocks.subscribeToTextStream).not.toHaveBeenCalledWith(
      "selection-rationale",
      expect.anything(),
      expect.anything(),
    )
    expect(
      screen.queryByRole("button", {
        name: /Refine selected ideas/,
      }),
    ).not.toBeInTheDocument()
  })

  it("replaces completed process accordions with initial deep-search links", () => {
    const selectedIdea = {
      ideaId: "prep-forecast-id",
      title: "Prep Forecast",
      description: "Recommend daily prep quantities.",
      selection: "selected" as const,
    }
    const completedRun = {
      status: "completed" as const,
      failedStage: null,
      researchPromptStreamId: null,
      research: [
        {
          deepSearchJobId: "initial-research",
          title: "Initial market research",
          slug: "initial-market-research",
          researchRequest: "Research the market before generating ideas.",
        },
      ],
      researchSummaryStreamId: null,
      ideaGenerationStreamId: null,
      ideas: [selectedIdea],
      ideaEvaluations: {},
      ideaSelectionStreamId: "selection",
      refinementGenerationStreamIds: {
        "prep-forecast-id": "refinement",
      },
      refinedIdeas: {
        "prep-forecast-id": {
          ideaId: "prep-forecast-id",
          title: "Confidence-Aware Prep Forecast",
          description: "Recommend prep ranges with confidence.",
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
    }
    render(
      <MemoryRouter>
        <IdeaJobView
          jobSlug="generated-ideas"
          prompt="Generate ideas"
          title="Generated ideas"
          run={completedRun}
        />
      </MemoryRouter>,
    )
    expect(
      screen.getByRole("heading", { name: "Initial deep research" }),
    ).toBeVisible()
    expect(
      screen.getByRole("link", { name: /Initial market research/ }),
    ).toHaveAttribute("href", "/deep-search/initial-market-research")
    expect(screen.queryByRole("heading", { name: "Progress" })).not.toBeInTheDocument()
    expect(
      screen.queryByText("How these ideas were developed"),
    ).not.toBeInTheDocument()
  })

  it.each([
    {
      failedStage: "refinement" as const,
      message: "One or more selected ideas could not be improved.",
      stageName: /Refine selected ideas Failed/,
    },
    {
      failedStage: "idea-research" as const,
      message: "Supporting research did not complete for every selected idea.",
      stageName: /Research improved ideas Failed/,
    },
  ])("explains a $failedStage failure in the downstream stage", ({ failedStage, message, stageName }) => {
    render(
      <MemoryRouter>
        <IdeaJobView
          jobSlug="generated-ideas"
          prompt="Generate ideas"
          title="Generated ideas"
          run={{
            status: "failed",
            failedStage,
            researchPromptStreamId: null,
            research: [],
            researchSummaryStreamId: null,
            ideaGenerationStreamId: null,
            ideas: [
              {
                ideaId: "prep-forecast-id",
                title: "Prep Forecast",
                description: "Recommend daily prep quantities.",
                selection: "selected",
              },
            ],
            ideaEvaluations: {},
            ideaSelectionStreamId: null,
            refinementGenerationStreamIds: {},
            refinedIdeas:
              failedStage === "idea-research"
                ? {
                    "prep-forecast-id": {
                      ideaId: "prep-forecast-id",
                      title: "Improved Prep Forecast",
                      description: "Recommend confidence-aware prep ranges.",
                    },
                  }
                : {},
            refinedIdeaResearch: {},
            error: "The workflow stopped",
          }}
        />
      </MemoryRouter>,
    )

    expect(
      screen.getByRole("button", {
        name: stageName,
      }),
    ).toBeVisible()
    expect(screen.getByText(message)).toBeVisible()
  })

  it("marks downstream work not run when selection fails after recording selections", () => {
    render(
      <MemoryRouter>
        <IdeaJobView
          jobSlug="generated-ideas"
          prompt="Generate ideas"
          title="Generated ideas"
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
                selection: "selected",
              },
            ],
            ideaEvaluations: {},
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
      screen.getByRole("button", {
        name: /Refine selected ideas Not run/,
      }),
    ).toBeVisible()
  })

  it("shows a refined idea title once and links to its research", () => {
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
            ideaEvaluations: {
              "prep-forecast-id": {
                pros: ["Clear operational value", "Practical workflow"],
                cons: ["Depends on clean data", "Needs staff adoption"],
                critique: "Promising with visible confidence and overrides.",
              },
            },
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
    expect(
      screen.getAllByText("Confidence-Aware Prep Forecast"),
    ).toHaveLength(1)
    expect(
      screen.getByRole("heading", { level: 2, name: "Improved idea" }),
    ).toBeVisible()
    expect(
      screen.getByText(
        "Recommend prep ranges with confidence and staff overrides.",
      ),
    ).toBeVisible()
    expect(screen.getByTestId("idea-assessment-0")).toBeVisible()
    expect(
      screen.getByRole("heading", { name: "Assessment of improved idea" }),
    ).toBeVisible()
    expect(
      screen.getByRole("heading", { level: 2, name: "Original candidate" }),
    ).toBeVisible()
    expect(screen.getByText("Prep Forecast")).toBeVisible()
    expect(
      screen.queryByRole("button", { name: "How this idea was developed" }),
    ).not.toBeInTheDocument()
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

  it("shows development details directly without an accordion", () => {
    const completedRun = {
      status: "completed" as const,
      failedStage: null,
      researchPromptStreamId: null,
      research: [],
      researchSummaryStreamId: null,
      ideaGenerationStreamId: "ideas",
      ideas: [
        {
          ideaId: "prep-forecast-id",
          title: "Prep Forecast",
          description: "Recommend fixed prep quantities.",
          selection: "selected" as const,
        },
      ],
      ideaEvaluations: {
        "prep-forecast-id": {
          pros: ["Practical"],
          cons: ["Needs data"],
          critique: "Worth improving.",
        },
      },
      ideaSelectionStreamId: "selection",
      refinementGenerationStreamIds: { "prep-forecast-id": "refinement" },
      refinedIdeas: {
        "prep-forecast-id": {
          ideaId: "prep-forecast-id",
          title: "Improved Prep Forecast",
          description: "Recommend prep ranges with visible uncertainty.",
        },
      },
      refinedIdeaResearch: {
        "prep-forecast-id": {
          deepSearchJobId: "prep-research",
          title: "Improved Prep Forecast",
          slug: "improved-prep-forecast",
          researchRequest: "Research the improved prep forecast.",
        },
      },
      error: null,
    }
    render(
      <MemoryRouter>
        <IdeaDetailView
          ideaId="prep-forecast-id"
          jobSlug="generated-ideas"
          jobTitle="Generated ideas"
          numberOfIdeas={1}
          run={completedRun}
        />
      </MemoryRouter>,
    )

    expect(
      screen.queryByRole("button", { name: "How this idea was developed" }),
    ).not.toBeInTheDocument()
    expect(screen.getByTestId("idea-assessment-0")).toBeVisible()
    expect(screen.getByRole("heading", { name: "Original candidate" })).toBeVisible()
    expect(screen.getByRole("heading", { name: "Decision" })).toBeVisible()
  })

  it("shows persisted ideas before selection starts", () => {
    render(
      <MemoryRouter>
        <IdeaJobView
          jobSlug="generated-ideas"
          prompt="Generate ideas"
          title="Generated ideas"
          run={{
          status: "running",
          failedStage: null,
          researchPromptStreamId: null,
          research: [],
          researchSummaryStreamId: null,
          ideaGenerationStreamId: "ideas",
          ideas: [
            {
              ideaId: "prep-forecast-id",
              title: "Prep Forecast",
              description: "Recommend daily prep quantities from recent demand.",
              selection: "pending",
            },
          ],
          ideaEvaluations: {},
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
    expect(
      screen.getByRole("link", { name: "View Prep Forecast" }),
    ).toBeVisible()
    expect(screen.getByText("Awaiting selection")).toBeVisible()
    expect(screen.getByText(/Comparing the generated ideas/)).toBeVisible()
    expect(screen.queryByText("Critique pending…")).not.toBeInTheDocument()
    expect(
      screen.queryByRole("button", { name: /Critique each idea/ }),
    ).not.toBeInTheDocument()
    expect(screen.queryByText("Generating ideas…")).not.toBeInTheDocument()
  })

  it("waits for a refinement stream before marking refinement running", () => {
    render(
      <MemoryRouter>
        <IdeaJobView
          jobSlug="generated-ideas"
          prompt="Generate ideas"
          title="Generated ideas"
          run={{
            ...initialIdeaJobState,
            status: "running",
            ideaGenerationStreamId: "ideas",
            ideaSelectionStreamId: "selection",
            ideas: [
              {
                ideaId: "prep-forecast-id",
                title: "Prep Forecast",
                description: "Recommend daily prep quantities.",
                selection: "selected",
              },
            ],
          }}
        />
      </MemoryRouter>,
    )

    expect(
      screen.getByRole("button", { name: /Refine selected ideas Waiting/ }),
    ).toBeVisible()
    expect(
      screen.getByText("Preparing to improve the selected ideas…"),
    ).toBeVisible()
  })

  it("marks started assessment work incomplete when the run is interrupted", () => {
    render(
      <MemoryRouter>
        <IdeaJobView
          jobSlug="generated-ideas"
          prompt="Generate ideas"
          title="Generated ideas"
          run={{
            ...initialIdeaJobState,
            status: "interrupted",
            error: "Workflow interrupted",
            ideaGenerationStreamId: "ideas",
            ideaSelectionStreamId: "selection",
            ideas: [
              {
                ideaId: "prep-forecast-id",
                title: "Prep Forecast",
                description: "Recommend daily prep quantities.",
                selection: "selected",
              },
              {
                ideaId: "closing-bundles-id",
                title: "Closing Bundles",
                description: "Bundle likely leftovers.",
                selection: "selected",
              },
            ],
            refinementGenerationStreamIds: {
              "prep-forecast-id": "prep-refinement",
              "closing-bundles-id": "bundles-refinement",
            },
            refinedIdeas: {
              "prep-forecast-id": {
                ideaId: "prep-forecast-id",
                title: "Improved Prep Forecast",
                description: "Recommend confidence-aware prep ranges.",
              },
              "closing-bundles-id": {
                ideaId: "closing-bundles-id",
                title: "Automatic Closing Bundles",
                description: "Create bundles from current till inventory.",
              },
            },
            refinedIdeaResearchCompleted: true,
            ideaEvaluationStreamIds: {
              "prep-forecast-id": "prep-evaluation",
            },
          }}
        />
      </MemoryRouter>,
    )

    expect(
      screen.getByRole("button", { name: /Research improved ideas Complete/ }),
    ).toBeVisible()
    expect(
      screen.getByRole("button", { name: /Assess improved ideas Incomplete/ }),
    ).toBeVisible()
    expect(
      screen.queryByRole("button", { name: /Assess improved ideas Not run/ }),
    ).not.toBeInTheDocument()
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
          ideaEvaluations: {},
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
    expect(
      screen.getByRole("button", { name: /Deep research Not run/ }),
    ).toBeVisible()
    expect(
      screen.getByRole("button", {
        name: /Summarise the research Not run/,
      }),
    ).toBeVisible()
    expect(
      screen.getByRole("button", {
        name: /Generate ideas Not run/,
      }),
    ).toBeVisible()
    expect(
      screen.queryByRole("button", { name: /Waiting/ }),
    ).not.toBeInTheDocument()
    expect(
      screen.getByText("Review what completed before the run stopped."),
    ).toBeVisible()
    expect(
      screen.queryByText(
        "Follow the current stage or expand an earlier stage for details.",
      ),
    ).not.toBeInTheDocument()
  })

  it("marks stages after a research failure as not run", () => {
    render(
      <IdeaJobView
        jobSlug="generated-ideas"
        title="Generated ideas"
        prompt="Generate ideas"
        run={{
          status: "failed",
          failedStage: "research",
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
          error: "Research failed",
        }}
      />,
    )

    expect(
      screen.getByRole("button", { name: /Plan the research Complete/ }),
    ).toBeVisible()
    expect(
      screen.getByRole("button", { name: /Deep research Failed/ }),
    ).toBeVisible()
    expect(
      screen.getByRole("button", {
        name: /Summarise the research Not run/,
      }),
    ).toBeVisible()
    expect(
      screen.getByRole("button", {
        name: /Generate ideas Not run/,
      }),
    ).toBeVisible()
    expect(
      screen.queryByRole("button", { name: /Waiting/ }),
    ).not.toBeInTheDocument()
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
          ideaEvaluations: {},
          ideaSelectionStreamId: null,
          refinementGenerationStreamIds: {},
          refinedIdeas: {},
          refinedIdeaResearch: {},
          error: "Idea generation failed before streaming",
        }}
      />,
    )

    expect(
      screen.getByRole("button", {
        name: /Generate ideas Failed/,
      }),
    ).toBeVisible()
    expect(
      screen.getByRole("button", { name: /Summarise the research Complete/ }),
    ).toBeVisible()
  })

  it("marks final assessment failure in the downstream stage", () => {
    render(
      <MemoryRouter>
        <IdeaJobView
          jobSlug="generated-ideas"
          prompt="Generate ideas"
          title="Generated ideas"
          run={{
          status: "failed",
          failedStage: "evaluation",
          researchPromptStreamId: "planning",
          research: [],
          researchSummaryStreamId: "summary",
          ideaGenerationStreamId: "ideas",
          ideas: [
            {
              ideaId: "prep-forecast-id",
              title: "Prep Forecast",
              description: "Recommend daily prep quantities from recent demand.",
              selection: "selected",
            },
          ],
          ideaEvaluations: {},
          ideaSelectionStreamId: "selection",
          refinementGenerationStreamIds: {
            "prep-forecast-id": "refinement",
          },
          refinedIdeas: {
            "prep-forecast-id": {
              ideaId: "prep-forecast-id",
              title: "Improved Prep Forecast",
              description: "Recommend confidence-aware prep ranges.",
            },
          },
          refinedIdeaResearch: {
            "prep-forecast-id": {
              deepSearchJobId: "prep-research",
              title: "Improved Prep Forecast",
              slug: "improved-prep-forecast",
              researchRequest: "Research the improved prep forecast.",
            },
          },
          error: "Evaluation failed before streaming",
          }}
        />
      </MemoryRouter>,
    )

    expect(
      screen.getByRole("button", {
        name: /Generate ideas Complete/,
      }),
    ).toBeVisible()
    expect(
      screen.getByRole("button", {
        name: /Assess improved ideas Failed/,
      }),
    ).toBeVisible()
    expect(
      screen.getByText("One or more improved ideas could not be assessed."),
    ).toBeVisible()
    expect(
      screen.getByRole("link", { name: "View Improved Prep Forecast" }),
    ).toBeVisible()
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

  it("keeps original metadata while refined content is provisional", async () => {
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
      stopRequested: false,
      canResume: false,
      canStop: true,
      error: null,
      creditsUsed: null,
      feedback: null,
      createdAt: new Date(),
      completedAt: null,
    })
    mocks.subscribeToIdeaJob.mockImplementation(async function* (
      _id: string,
      signal?: AbortSignal,
    ) {
      yield {
        type: "idea" as const,
        ideaId: "prep-forecast-id",
        title: "Prep Forecast",
        description: "Recommend fixed prep quantities.",
      }
      yield {
        type: "selected-ideas" as const,
        selectedIdeaIds: ["prep-forecast-id"],
      }
      yield {
        type: "refined-idea" as const,
        ideaId: "prep-forecast-id",
        title: "Confidence-Aware Prep Forecast",
        description: "Recommend prep ranges with staff overrides.",
      }
      await new Promise<void>((resolve) => {
        if (signal?.aborted) resolve()
        else signal?.addEventListener("abort", () => resolve(), { once: true })
      })
    })

    renderIdeas("/ideas/independent-cafe-ideas/prep-forecast-id")

    await screen.findByRole("heading", {
      name: "Confidence-Aware Prep Forecast",
    })
    await waitFor(() =>
      expect(document.title).toBe("Prep Forecast — RethinkLoop"),
    )
    expect(screen.getByText("Researching improved idea")).toBeVisible()
  })

  it("uses the final refined idea as public article metadata", async () => {
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
        type: "selected-ideas" as const,
        selectedIdeaIds: ["prep-forecast-id"],
      }
      yield {
        type: "refined-idea" as const,
        ideaId: "prep-forecast-id",
        title: "Confidence-Aware Prep Forecast",
        description: "Recommend prep ranges with staff overrides.",
      }
      yield {
        type: "idea-evaluation-stream" as const,
        ideaId: "prep-forecast-id",
        streamId: "prep-evaluation",
      }
      yield {
        type: "idea-evaluated" as const,
        ideaId: "prep-forecast-id",
        pros: ["Clear value", "Practical workflow"],
        cons: ["Data dependency", "Adoption risk"],
        critique: "Ready after research and assessment.",
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

  it("preserves final server metadata until terminal replay catches up", async () => {
    const pageKey = "/ideas/independent-cafe-ideas/prep-forecast-id"
    document.documentElement.dataset.seoPage = pageKey
    document.title = "Confidence-Aware Prep Forecast — RethinkLoop"
    const description =
      document.head.querySelector<HTMLMetaElement>('meta[name="description"]') ??
      document.head.appendChild(document.createElement("meta"))
    description.name = "description"
    description.content = "Recommend prep ranges with staff overrides."

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
      stopRequested: false,
      canResume: false,
      canStop: false,
      error: null,
      creditsUsed: 100,
      feedback: null,
      createdAt: new Date(),
      completedAt: new Date(),
    })
    let continueReplay: (() => void) | undefined
    const replayPaused = new Promise<void>((resolve) => {
      continueReplay = resolve
    })
    mocks.subscribeToIdeaJob.mockImplementation(async function* () {
      yield {
        type: "idea" as const,
        ideaId: "prep-forecast-id",
        title: "Prep Forecast",
        description: "Recommend fixed prep quantities.",
      }
      await replayPaused
      yield {
        type: "selected-ideas" as const,
        selectedIdeaIds: ["prep-forecast-id"],
      }
      yield {
        type: "refined-idea" as const,
        ideaId: "prep-forecast-id",
        title: "Confidence-Aware Prep Forecast",
        description: "Recommend prep ranges with staff overrides.",
      }
      yield {
        type: "idea-evaluated" as const,
        ideaId: "prep-forecast-id",
        pros: ["Clear value", "Practical workflow"],
        cons: ["Data dependency", "Adoption risk"],
        critique: "Ready after research and assessment.",
      }
      yield { type: "done" as const }
    })

    renderIdeas(pageKey)

    expect(
      await screen.findByRole("heading", { name: "Prep Forecast" }),
    ).toBeVisible()
    expect(document.title).toBe(
      "Confidence-Aware Prep Forecast — RethinkLoop",
    )
    expect(description).toHaveAttribute(
      "content",
      "Recommend prep ranges with staff overrides.",
    )

    await act(async () => {
      continueReplay?.()
      await replayPaused
    })

    await waitFor(() =>
      expect(
        screen.getByRole("heading", {
          name: "Confidence-Aware Prep Forecast",
        }),
      ).toBeVisible(),
    )
    expect(document.title).toBe(
      "Confidence-Aware Prep Forecast — RethinkLoop",
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
            ideaEvaluations: {},
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
        "Selection starts after every idea has been evaluated…",
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
            ideaEvaluations: {},
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

    const previousRun = await screen.findByRole("link", {
      name: /Previously Generated Ideas/,
    })
    expect(previousRun).toHaveAttribute("href", "/ideas/previously-generated-ideas")
    expect(within(previousRun).getByText(/2026/)).toBeVisible()
    expect(screen.getByText("Complete")).toBeVisible()
  })
})
