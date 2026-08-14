import {
  act,
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

  it("shows an unselected idea title once with its description and assessment", () => {
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
    const processDetails = screen.getByRole("button", {
      name: "How this idea was developed",
    })
    expect(processDetails).toHaveAttribute("aria-expanded", "false")
    fireEvent.click(processDetails)
    expect(screen.getByTestId("idea-assessment-0")).toBeVisible()
    expect(
      screen.getByRole("heading", {
        name: "Assessment of original idea",
      }),
    ).toBeVisible()
    expect(screen.getByRole("heading", { name: "Pros" })).toBeVisible()
    expect(screen.getByRole("heading", { name: "Cons" })).toBeVisible()
    expect(screen.getByText("Depends on clean till data.")).toBeVisible()
    expect(
      screen.getByText(
        "A useful concept that needs confidence ranges and staff overrides.",
      ),
    ).toBeVisible()
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
      name: /Generate and assess ideas Complete/,
    })
    expect(ideaStage).toHaveAttribute("aria-expanded", "false")
    const improvementStage = screen.getByRole("button", {
      name: /Improve and research selected ideas Running/,
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
    expect(screen.getByText("Not selected")).toBeVisible()
    expect(screen.getByText("Improved")).toBeVisible()
    expect(screen.getByText("Improving")).toBeVisible()
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
      screen.queryByRole("button", { name: /Select ideas/ }),
    ).not.toBeInTheDocument()
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
      name: /Generate and assess ideas Running/,
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
        name: /Generate and assess ideas Complete/,
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
        name: /Improve and research selected ideas/,
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
        name: /Improve and research selected ideas/,
      }),
    ).not.toBeInTheDocument()
  })

  it("keeps a focused downstream stage until focus leaves after completion", () => {
    const selectedIdea = {
      ideaId: "prep-forecast-id",
      title: "Prep Forecast",
      description: "Recommend daily prep quantities.",
      selection: "selected" as const,
    }
    const runningRun = {
      status: "running" as const,
      failedStage: null,
      researchPromptStreamId: null,
      research: [],
      researchSummaryStreamId: null,
      ideaGenerationStreamId: null,
      ideas: [selectedIdea],
      ideaEvaluations: {},
      ideaSelectionStreamId: "selection",
      refinementGenerationStreamIds: {
        "prep-forecast-id": "refinement",
      },
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
          run={runningRun}
        />
      </MemoryRouter>,
    )
    const improvementStage = screen.getByRole("button", {
      name: /Improve and research selected ideas Running/,
    })
    act(() => improvementStage.focus())

    rerender(
      <MemoryRouter>
        <IdeaJobView
          jobSlug="generated-ideas"
          prompt="Generate ideas"
          title="Generated ideas"
          run={{
            ...runningRun,
            status: "completed",
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

    expect(improvementStage).toHaveFocus()
    expect(improvementStage).toHaveTextContent("Complete")

    const ideaLink = screen.getByRole("link", {
      name: "View Confidence-Aware Prep Forecast",
    })
    act(() => ideaLink.focus())

    expect(ideaLink).toHaveFocus()
    expect(
      screen.queryByRole("button", {
        name: /Improve and research selected ideas/,
      }),
    ).not.toBeInTheDocument()
  })

  it.each([
    {
      failedStage: "refinement" as const,
      message: "One or more selected ideas could not be improved.",
    },
    {
      failedStage: "idea-research" as const,
      message: "Supporting research did not complete for every selected idea.",
    },
  ])("explains a $failedStage failure in the downstream stage", ({ failedStage, message }) => {
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
        name: /Improve and research selected ideas Failed/,
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
        name: /Improve and research selected ideas Not run/,
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
    const processDetails = screen.getByRole("button", {
      name: "How this idea was developed",
    })
    expect(processDetails).toHaveAttribute("aria-expanded", "false")
    expect(screen.getByText("Prep Forecast")).not.toBeVisible()
    expect(
      screen
        .getByRole("heading", { level: 2, name: "Improved idea" })
        .compareDocumentPosition(processDetails) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy()
    expect(
      screen.getByText(
        "Recommend prep ranges with confidence and staff overrides.",
      ),
    ).toBeVisible()
    expect(screen.getByTestId("idea-assessment-0")).not.toBeVisible()
    fireEvent.click(processDetails)
    expect(screen.getByTestId("idea-assessment-0")).toBeVisible()
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

  it("preserves a manually expanded idea-development section through completion", () => {
    const runningRun = {
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
      refinementGenerationStreamIds: {},
      refinedIdeas: {},
      refinedIdeaResearch: {},
      error: null,
    }
    const renderView = (status: "running" | "completed") => (
      <MemoryRouter>
        <IdeaDetailView
          ideaId="prep-forecast-id"
          jobSlug="generated-ideas"
          jobTitle="Generated ideas"
          numberOfIdeas={1}
          run={{ ...runningRun, status }}
        />
      </MemoryRouter>
    )
    const { rerender } = render(renderView("running"))
    const processDetails = screen.getByRole("button", {
      name: "How this idea was developed",
    })
    expect(processDetails).toHaveAttribute("aria-expanded", "true")

    fireEvent.click(processDetails)
    fireEvent.click(processDetails)
    act(() => processDetails.focus())
    rerender(renderView("completed"))

    expect(
      screen.getByRole("button", { name: "How this idea was developed" }),
    ).toBe(processDetails)
    expect(processDetails).toHaveAttribute("aria-expanded", "true")
    expect(processDetails).toHaveFocus()
    expect(screen.getByTestId("idea-assessment-0")).toBeVisible()
  })

  it("shows persisted ideas before their evaluation calls start", () => {
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
      screen.getByRole("button", {
        name: /Generate and assess ideas Running/,
      }),
    ).toBeVisible()
    expect(screen.getByRole("link", { name: "View Prep Forecast" })).toBeVisible()
    expect(screen.getByText("Awaiting selection")).toBeVisible()
    expect(screen.getByText(/Evaluating ideas/)).toBeVisible()
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
        name: /Generate and assess ideas Not run/,
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
        name: /Generate and assess ideas Not run/,
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
        name: /Generate and assess ideas Failed/,
      }),
    ).toBeVisible()
    expect(
      screen.getByRole("button", { name: /Summarise the research Complete/ }),
    ).toBeVisible()
  })

  it("marks the combined idea stage failed when evaluation creation fails", () => {
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
              selection: "pending",
            },
          ],
          ideaEvaluations: {},
          ideaSelectionStreamId: null,
          refinementGenerationStreamIds: {},
          refinedIdeas: {},
          refinedIdeaResearch: {},
          error: "Evaluation failed before streaming",
          }}
        />
      </MemoryRouter>,
    )

    expect(
      screen.getByRole("button", {
        name: /Generate and assess ideas Failed/,
      }),
    ).toBeVisible()
    expect(screen.getByRole("link", { name: "View Prep Forecast" })).toBeVisible()
    expect(screen.getByText("Selection incomplete")).toBeVisible()
    expect(screen.queryByText("Awaiting selection")).not.toBeInTheDocument()
    expect(
      screen.queryByText("Assessment did not start for this idea."),
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

    expect(
      await screen.findByRole("link", { name: /Previously Generated Ideas/ }),
    ).toHaveAttribute("href", "/ideas/previously-generated-ideas")
    expect(screen.getByText("Complete")).toBeVisible()
  })
})
