import { fireEvent, render, screen, waitFor, within } from "@testing-library/react"
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { MemoryRouter, Route, Routes } from "react-router-dom"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import type { DebateTournamentSnapshot } from "../../lib/debateJobs.ts"

const mocks = vi.hoisted(() => ({
  createDebateJob: vi.fn(),
  getDebateJob: vi.fn(),
  getDebateJobs: vi.fn(),
  subscribeToDebateJob: vi.fn(),
  subscribeToIdeaJob: vi.fn(),
  subscribeToTextStream: vi.fn(),
  updateDebateJob: vi.fn(),
  requestResearchStop: vi.fn(),
  updateResultFeedback: vi.fn(),
}))

vi.mock("../../lib/debateJobs.ts", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../lib/debateJobs.ts")>()),
  createDebateJob: mocks.createDebateJob,
  getDebateJob: mocks.getDebateJob,
  getDebateJobs: mocks.getDebateJobs,
  subscribeToDebateJob: mocks.subscribeToDebateJob,
  updateDebateJob: mocks.updateDebateJob,
}))

vi.mock("../../lib/textStreams.ts", () => ({
  subscribeToTextStream: mocks.subscribeToTextStream,
}))

vi.mock("../../lib/ideaJobs.ts", () => ({
  subscribeToIdeaJob: mocks.subscribeToIdeaJob,
}))

vi.mock("../../lib/researchCancellation.ts", () => ({
  requestResearchStop: mocks.requestResearchStop,
}))

vi.mock("../../lib/resultFeedback.ts", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../lib/resultFeedback.ts")>()),
  updateResultFeedback: mocks.updateResultFeedback,
}))

import { Debates } from "./index.tsx"

function tournament(
  overrides: Partial<DebateTournamentSnapshot> = {},
): DebateTournamentSnapshot {
  const firstIdea = {
    ideaId: "first",
    position: 0,
    title: "First idea",
    description: "First description",
  }
  const secondIdea = {
    ideaId: "second",
    position: 1,
    title: "Second idea",
    description: "Second description",
  }
  return {
    debateJobId: "debate-id",
    ideaJobId: "idea-job-id",
    title: "Better Café Ideas",
    slug: "better-cafe-ideas",
    prompt: "Design a better café",
    isPublic: false,
    isOwner: true,
    stopRequested: false,
    canStop: true,
    stage: "swiss",
    status: "running",
    expectedMatchCount: 33,
    rounds: [
      {
        debateRoundId: "round",
        stage: "swiss",
        stageRoundNumber: 1,
        matches: [
          {
            debateMatchId: "match",
            position: 0,
            firstIdea,
            secondIdea,
            winnerIdeaId: null,
            status: "running",
            messages: [
              {
                debateMessageId: "message",
                position: 0,
                speakerSlot: 0,
                llmGenerationId: "generation",
                text: "",
                createdAt: new Date("2026-08-04T12:00:00.000Z"),
              },
            ],
          },
        ],
      },
    ],
    standings: [
      { idea: firstIdea, wins: 0, elo: 1500 },
      { idea: secondIdea, wins: 0, elo: 1500 },
    ],
    error: null,
    creditsUsed: null,
    feedback: null,
    ...overrides,
  }
}

function renderDebates(initialEntry = "/debates") {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  })
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={[initialEntry]}>
        <Routes>
          <Route path="/debates" element={<Debates />} />
          <Route path="/debates/:slug" element={<Debates />} />
          <Route
            path="/debates/:slug/matches/:matchId"
            element={<Debates />}
          />
          <Route path="/ideas" element={<div>Idea generator</div>} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  )
}

describe("Debates", () => {
  afterEach(() => {
    vi.unstubAllGlobals()
    document.head
      .querySelectorAll(
        'meta[name], meta[property], link[rel="canonical"], script[data-seo-json-ld]',
      )
      .forEach((element) => element.remove())
    document.title = ""
    delete document.documentElement.dataset.seoPage
  })

  beforeEach(() => {
    vi.clearAllMocks()
    mocks.createDebateJob.mockResolvedValue({
      debateJobId: "debate-id",
      slug: "better-cafe-ideas",
    })
    mocks.getDebateJob.mockResolvedValue(tournament())
    mocks.getDebateJobs.mockResolvedValue([])
    mocks.updateDebateJob.mockResolvedValue({ isPublic: true })
    mocks.requestResearchStop.mockResolvedValue({
      status: "cancellation-requested",
      cancelRequestedAt: new Date("2026-08-15T00:00:00.000Z"),
    })
    mocks.updateResultFeedback.mockResolvedValue({
      rating: false,
      hasWrittenFeedback: false,
    })
    mocks.subscribeToDebateJob.mockImplementation(async function* (
      _id: string,
      signal?: AbortSignal,
    ) {
      await new Promise<void>((resolve) => {
        if (signal?.aborted) resolve()
        else signal?.addEventListener("abort", () => resolve(), { once: true })
      })
      yield* []
    })
    mocks.subscribeToIdeaJob.mockImplementation(async function* (
      _id: string,
      signal?: AbortSignal,
    ) {
      await new Promise<void>((resolve) => {
        if (signal?.aborted) resolve()
        else signal?.addEventListener("abort", () => resolve(), { once: true })
      })
      yield* []
    })
    mocks.subscribeToTextStream.mockImplementation(async function* () {
      await Promise.resolve()
      yield { type: "text" as const, text: "Live opening argument" }
      yield { type: "done" as const }
    })
  })

  it("places feedback on the completed owner debate and omits it from match pages", async () => {
    mocks.getDebateJob.mockResolvedValue(
      tournament({
        status: "completed",
        stage: "final",
        canStop: false,
        creditsUsed: 456,
        feedback: { rating: null, hasWrittenFeedback: false },
      }),
    )

    const debate = renderDebates("/debates/better-cafe-ideas")
    const down = await screen.findByRole("button", { name: "Thumbs down" })
    expect(screen.getByText("456 credits")).toBeVisible()
    fireEvent.click(down)
    expect(
      await screen.findByRole("dialog", { name: "What could be improved?" }),
    ).toBeVisible()
    expect(mocks.updateResultFeedback).toHaveBeenCalledWith(
      "debate",
      "debate-id",
      { type: "rating", rating: false },
    )
    debate.unmount()

    renderDebates("/debates/better-cafe-ideas/matches/match")
    expect(
      screen.queryByRole("button", { name: "Thumbs down" }),
    ).not.toBeInTheDocument()
  })

  it("describes the tournament without fixed match or round counts", () => {
    renderDebates()

    expect(document.body).toHaveTextContent("research competing ideas")
    expect(document.body).toHaveTextContent("test them head-to-head")
    expect(document.body).not.toHaveTextContent(
      /\b33\b|five rounds|four ideas|semifinals?/i,
    )
  })

  it("starts a private tournament and opens its live match transcript", async () => {
    renderDebates()

    fireEvent.change(screen.getByLabelText("What should the ideas solve?"), {
      target: { value: "  Design a better café  " },
    })
    fireEvent.click(screen.getByRole("button", { name: "Start a debate" }))

    const liveMatchLink = await screen.findByRole("link", {
      name: "Open First idea versus Second idea",
    })
    expect(liveMatchLink).toHaveAttribute(
      "href",
      "/debates/better-cafe-ideas/matches/match",
    )
    expect(
      screen.getByRole("link", {
        name: "View the underlying idea generation",
      }),
    ).toHaveAttribute("href", "/ideas/better-cafe-ideas")
    fireEvent.click(liveMatchLink)

    expect(await screen.findByText("Live opening argument")).toBeVisible()
    expect(
      screen.getByRole("heading", { name: "First idea vs Second idea" }),
    ).toBeVisible()
    expect(screen.getByRole("link", { name: "Back to debate" })).toHaveAttribute(
      "href",
      "/debates/better-cafe-ideas",
    )
    expect(screen.getByRole("link", { name: "First idea" })).toHaveAttribute(
      "href",
      "/ideas/better-cafe-ideas/first#improved-idea",
    )
    expect(screen.getByRole("link", { name: "First idea" })).toHaveAttribute(
      "target",
      "_blank",
    )
    expect(screen.getByRole("link", { name: "Second idea" })).toHaveAttribute(
      "href",
      "/ideas/better-cafe-ideas/second#improved-idea",
    )
    expect(mocks.createDebateJob).toHaveBeenCalledWith({
      prompt: "Design a better café",
      isPublic: false,
      numberOfIdeas: 8,
    })
    expect(mocks.getDebateJob).toHaveBeenCalledWith(
      "better-cafe-ideas",
      expect.any(AbortSignal),
    )
    expect(mocks.subscribeToDebateJob).toHaveBeenCalledWith(
      "debate-id",
      expect.any(AbortSignal),
      expect.any(Function),
    )
    expect(mocks.subscribeToTextStream).toHaveBeenCalledWith(
      "generation",
      expect.any(AbortSignal),
      expect.any(Function),
    )
  })

  it("makes ongoing idea generation explicit when a debate is opened", async () => {
    mocks.getDebateJob.mockResolvedValue(
      tournament({
        stage: "ideas",
        expectedMatchCount: null,
        rounds: [],
        standings: [],
      }),
    )

    renderDebates("/debates/better-cafe-ideas")

    expect(
      await screen.findByRole("heading", {
        name: "Generating and improving debate ideas…",
      }),
    ).toBeVisible()
    expect(screen.getByRole("status")).toBeVisible()
    expect(
      screen.getByText(/debate rounds will start automatically/i),
    ).toBeVisible()
  })

  it("prefills a question handed off from the landing page", () => {
    renderDebates("/debates?prompt=Should%20we%20enter%20this%20market%3F")

    expect(screen.getByLabelText("What should the ideas solve?")).toHaveValue(
      "Should we enter this market?",
    )
  })

  it("does not ask for publishing before creating a debate", () => {
    renderDebates()

    expect(
      screen.queryByRole("switch", { name: /public/i }),
    ).not.toBeInTheDocument()
    expect(screen.queryByText(/Private by default/)).not.toBeInTheDocument()
  })

  it("lets the owner publish a debate and copy its canonical URL", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined)
    vi.stubGlobal("navigator", {
      ...navigator,
      clipboard: { writeText },
    })
    renderDebates("/debates/debate-id")

    fireEvent.click(await screen.findByRole("button", { name: "Share" }))
    fireEvent.click(screen.getByRole("button", { name: "Make public" }))
    await waitFor(() =>
      expect(mocks.updateDebateJob).toHaveBeenCalledWith(
        "debate-id",
        { isPublic: true },
      ),
    )
    const copyButton = await screen.findByRole("button", { name: "Copy link" })
    fireEvent.click(copyButton)

    await waitFor(() =>
      expect(writeText).toHaveBeenCalledWith(
        `${window.location.origin}/debates/debate-id`,
      ),
    )
    expect(screen.getByRole("button", { name: "Copied" })).toBeVisible()
  })

  it("clears a dismissed visibility error before Share is reopened", async () => {
    mocks.updateDebateJob.mockRejectedValueOnce(new Error("Network failed"))
    renderDebates("/debates/debate-id")

    fireEvent.click(await screen.findByRole("button", { name: "Share" }))
    fireEvent.click(screen.getByRole("button", { name: "Make public" }))

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Could not connect to the server. Check your connection and try again.",
    )
    fireEvent.click(screen.getByRole("button", { name: "Close" }))
    await waitFor(() =>
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument(),
    )

    fireEvent.click(screen.getByRole("button", { name: "Share" }))

    expect(screen.queryByRole("alert")).not.toBeInTheDocument()
  })

  it("keeps a running public debate public until its streams finish", async () => {
    mocks.getDebateJob.mockResolvedValue(tournament({ isPublic: true }))

    renderDebates("/debates/debate-id")

    fireEvent.click(await screen.findByRole("button", { name: "Share" }))
    expect(
      screen.getByText("A live public debate can be made private after it finishes."),
    ).toBeVisible()
    expect(
      screen.queryByRole("button", { name: "Make private" }),
    ).not.toBeInTheDocument()
    expect(mocks.updateDebateJob).not.toHaveBeenCalled()
  })

  it("keeps private details out of search metadata", async () => {
    renderDebates("/debates/debate-id")

    await screen.findByText("Better Café Ideas")
    await waitFor(() =>
      expect(
        document.head.querySelector('meta[name="robots"]'),
      ).toHaveAttribute("content", "noindex, nofollow"),
    )
    expect(document.head.querySelector('link[rel="canonical"]')).toBeNull()
    expect(
      document.head.querySelector('script[data-seo-json-ld="true"]'),
    ).toBeNull()
  })

  it("publishes completed public details as article metadata", async () => {
    mocks.getDebateJob.mockResolvedValue(
      tournament({ isPublic: true, stage: "final", status: "completed" }),
    )

    renderDebates("/debates/better-cafe-ideas")

    await screen.findByText("Better Café Ideas")
    await waitFor(() =>
      expect(document.title).toBe("Better Café Ideas — RethinkLoop"),
    )
    expect(document.head.querySelector('meta[name="robots"]')).toHaveAttribute(
      "content",
      "index, follow",
    )
    expect(document.head.querySelector('meta[property="og:type"]')).toHaveAttribute(
      "content",
      "article",
    )
    expect(document.head.querySelector('link[rel="canonical"]')).toHaveAttribute(
      "href",
      "https://rethinkloop.com/debates/better-cafe-ideas",
    )
  })

  it("preserves matching server metadata while a direct match is loading", () => {
    mocks.getDebateJob.mockReturnValue(new Promise(() => undefined))
    const matchPath =
      "/debates/better%20caf%C3%A9/matches/first%20match"
    document.documentElement.dataset.seoPage = matchPath
    document.title = "First idea vs Second idea — RethinkLoop"
    const robots = document.createElement("meta")
    robots.name = "robots"
    robots.content = "index, follow"
    document.head.appendChild(robots)
    const canonical = document.createElement("link")
    canonical.rel = "canonical"
    canonical.href = "https://rethinkloop.com/debates/better-cafe-ideas"
    document.head.appendChild(canonical)

    renderDebates(matchPath)

    expect(screen.getByRole("progressbar")).toBeVisible()
    expect(document.title).toBe("First idea vs Second idea — RethinkLoop")
    expect(document.head.querySelector('meta[name="robots"]')).toHaveAttribute(
      "content",
      "index, follow",
    )
    expect(document.head.querySelector('link[rel="canonical"]')).toHaveAttribute(
      "href",
      "https://rethinkloop.com/debates/better-cafe-ideas",
    )
    expect(document.documentElement.dataset.seoPage).toBe(matchPath)
  })

  it("does not show visibility controls to a public viewer", async () => {
    mocks.getDebateJob.mockResolvedValue(
      tournament({ isOwner: false, isPublic: true, canStop: false }),
    )

    renderDebates("/debates/debate-id")

    expect(await screen.findByText("Better Café Ideas")).toBeVisible()
    expect(
      screen.queryByRole("button", { name: "Share" }),
    ).not.toBeInTheDocument()
    expect(screen.queryByText("Public")).not.toBeInTheDocument()
    expect(screen.queryByRole("button", { name: "Copy link" })).not.toBeInTheDocument()
    expect(
      screen.queryByRole("button", { name: "Stop workflow" }),
    ).not.toBeInTheDocument()
  })

  it("requests Stop and immediately reconciles the running snapshot", async () => {
    renderDebates("/debates/better-cafe-ideas")

    fireEvent.click(
      await screen.findByRole("button", { name: "Stop workflow" }),
    )
    const dialog = screen.getByRole("dialog", { name: "Stop this workflow?" })
    fireEvent.click(
      within(dialog).getByRole("button", { name: "Stop workflow" }),
    )

    await waitFor(() =>
      expect(mocks.requestResearchStop).toHaveBeenCalledWith(
        "debate",
        "debate-id",
      ),
    )
    expect(
      await screen.findByRole("button", { name: "Stopping…" }),
    ).toBeDisabled()
  })

  it("presents a directly stopped debate while retaining completed work", async () => {
    const stopped = tournament({
      status: "interrupted",
      stopRequested: true,
      canStop: false,
      error: "Workflow stopped by user",
    })
    const retainedMatch = stopped.rounds[0].matches[0]
    retainedMatch.status = "completed"
    retainedMatch.winnerIdeaId = retainedMatch.firstIdea.ideaId
    retainedMatch.messages[0].text = "A retained completed opening"
    mocks.getDebateJob.mockResolvedValue(
      stopped,
    )

    renderDebates("/debates/better-cafe-ideas")

    expect((await screen.findAllByText("Stopped")).length).toBeGreaterThan(0)
    expect(
      screen.getByText(
        "You stopped this debate. Completed matches and messages are kept.",
      ),
    ).toBeVisible()
    fireEvent.click(screen.getByText("Round 1"))
    fireEvent.click(
      screen.getByRole("link", {
        name: "Open First idea versus Second idea",
      }),
    )
    expect(await screen.findByText("A retained completed opening")).toBeVisible()
  })

  it("restores a match directly from its URL with adjacent navigation", async () => {
    const snapshot = tournament({ status: "completed" })
    const firstMatch = snapshot.rounds[0].matches[0]
    const nextMatch = {
      ...firstMatch,
      debateMatchId: "next-match",
      position: 1,
      firstIdea: {
        ...firstMatch.secondIdea,
        ideaId: "third",
        title: "Third idea",
      },
      status: "completed" as const,
    }
    mocks.getDebateJob.mockResolvedValue({
      ...snapshot,
      rounds: [
        {
          ...snapshot.rounds[0],
          matches: [firstMatch, nextMatch],
        },
      ],
    })

    renderDebates("/debates/better-cafe-ideas/matches/next-match")

    expect(
      await screen.findByRole("heading", {
        name: "Third idea vs Second idea",
      }),
    ).toBeVisible()
    expect(
      screen.getByRole("link", {
        name: "Previous: First idea versus Second idea",
      }),
    ).toHaveAttribute(
      "href",
      "/debates/better-cafe-ideas/matches/match",
    )
    expect(
      screen
        .getByRole("link", {
          name: "Previous: First idea versus Second idea",
        })
        .compareDocumentPosition(
          screen.getByRole("heading", {
            name: "Third idea vs Second idea",
          }),
        ) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy()
    expect(screen.getByRole("link", { name: "Back to debate" })).toHaveAttribute(
      "href",
      "/debates/better-cafe-ideas",
    )
    expect(mocks.getDebateJob).toHaveBeenCalledWith(
      "better-cafe-ideas",
      expect.any(AbortSignal),
    )
  })

  it("shows a debate-scoped not-found state for an invalid match URL", async () => {
    mocks.getDebateJob.mockResolvedValue(
      tournament({ isPublic: true, stage: "final", status: "completed" }),
    )
    renderDebates("/debates/better-cafe-ideas/matches/missing-match")

    expect(
      await screen.findByRole("heading", { name: "Match not found" }),
    ).toBeVisible()
    expect(screen.getByRole("link", { name: "Back to debate" })).toHaveAttribute(
      "href",
      "/debates/better-cafe-ideas",
    )
    expect(
      screen.queryByRole("heading", { name: "Debate conversation" }),
    ).not.toBeInTheDocument()
    await waitFor(() =>
      expect(document.title).toBe("Match not found — RethinkLoop"),
    )
    expect(document.head.querySelector('meta[name="robots"]')).toHaveAttribute(
      "content",
      "noindex, nofollow",
    )
    expect(document.head.querySelector('link[rel="canonical"]')).toBeNull()
    expect(
      document.head.querySelector('script[data-seo-json-ld="true"]'),
    ).toBeNull()
  })

  it.each([
    ["failed", "Debate failed"],
    ["interrupted", "Interrupted"],
  ] as const)(
    "explains a %s tournament from a direct match URL without exposing its internal error",
    async (status, statusLabel) => {
      mocks.getDebateJob.mockResolvedValue(
        tournament({
          status,
          error: "Internal provider failure details",
        }),
      )

      renderDebates("/debates/better-cafe-ideas/matches/match")

      expect((await screen.findAllByText(statusLabel)).length).toBeGreaterThan(0)
      expect(
        screen.getByText(
          status === "interrupted"
            ? "The debate was interrupted before it could finish. Review any completed matches, or start a new debate."
            : "The debate stopped before it could finish. Review any completed matches, or start a new debate.",
        ),
      ).toBeVisible()
      expect(
        screen.getByRole("link", { name: "Start a new debate" }),
      ).toHaveAttribute("href", "/debates")
      expect(
        screen.queryByText("Internal provider failure details"),
      ).not.toBeInTheDocument()
    },
  )

  it("restores a completed tournament from its durable snapshot", async () => {
    const first = tournament().rounds[0].matches[0].firstIdea
    const second = tournament().rounds[0].matches[0].secondIdea
    mocks.getDebateJob.mockResolvedValue(
      tournament({
        stage: "final",
        status: "completed",
        rounds: [
          {
            debateRoundId: "final-round",
            stage: "final",
            stageRoundNumber: 1,
            matches: [
              {
                debateMatchId: "final-match",
                position: 0,
                firstIdea: first,
                secondIdea: second,
                winnerIdeaId: first.ideaId,
                status: "completed",
                messages: [
                  {
                    debateMessageId: "verdict",
                    position: 4,
                    speakerSlot: 2,
                    llmGenerationId: "judge-generation",
                    text: "The first idea is more practical.",
                    createdAt: new Date("2026-08-04T12:05:00.000Z"),
                  },
                ],
              },
            ],
          },
        ],
      }),
    )
    mocks.subscribeToIdeaJob.mockImplementation(async function* () {
      await Promise.resolve()
      yield {
        type: "idea-evaluated" as const,
        ideaId: "first",
        pros: ["Practical", "Inexpensive to build"],
        cons: ["Needs staff training"],
        critique: "A solid option that requires adoption effort.",
      }
      yield { type: "done" as const }
    })

    renderDebates("/debates/better-cafe-ideas")

    expect(
      await screen.findByRole("heading", { name: "First idea" }),
    ).toBeVisible()
    expect(
      screen.getByRole("heading", { name: "Decisive strengths" }),
    ).toBeVisible()
    expect(screen.getByText("The first idea is more practical.")).toBeVisible()
    const prosAndCons = screen.getByRole("region", { name: "Pros and cons" })
    expect(
      within(prosAndCons).getByRole("heading", { name: "Pros and cons" }),
    ).toBeVisible()
    expect(
      within(prosAndCons).getByRole("heading", { name: "Pros" }),
    ).toBeVisible()
    expect(
      within(prosAndCons).getByRole("heading", { name: "Cons" }),
    ).toBeVisible()
    expect(within(prosAndCons).getByText("Practical")).toBeVisible()
    expect(within(prosAndCons).getByText("Inexpensive to build")).toBeVisible()
    expect(within(prosAndCons).getByText("Needs staff training")).toBeVisible()
    const winnerHeading = screen.getByRole("heading", { name: "First idea" })
    expect(within(winnerHeading).getByRole("link")).toHaveAttribute(
      "href",
      "/ideas/better-cafe-ideas/first#improved-idea",
    )
    expect(within(winnerHeading).getByRole("link")).toHaveAttribute(
      "target",
      "_blank",
    )
    const closestAlternative = screen.getByRole("region", {
      name: "Closest alternative",
    })
    expect(
      within(closestAlternative).getByRole("heading", {
        name: "Closest alternative",
      }),
    ).toBeVisible()
    const alternativeLink = within(closestAlternative).getByRole("link", {
      name: "Second idea",
    })
    expect(alternativeLink).toHaveAttribute(
      "href",
      "/ideas/better-cafe-ideas/second#improved-idea",
    )
    expect(alternativeLink).toHaveAttribute("target", "_blank")
    expect(
      within(closestAlternative).getByText("Second description", {
        exact: true,
      }),
    ).toBeVisible()
    expect(
      screen.getByRole("link", {
        name: "View the underlying idea generation",
      }),
    ).toHaveAttribute("href", "/ideas/better-cafe-ideas")
    await waitFor(() => expect(mocks.subscribeToDebateJob).not.toHaveBeenCalled())
    expect(mocks.subscribeToIdeaJob).toHaveBeenCalledWith(
      "idea-job-id",
      expect.any(AbortSignal),
      expect.any(Function),
    )
    expect(mocks.subscribeToTextStream).not.toHaveBeenCalled()
  })

  it("refreshes the durable snapshot when the event feed reports progress", async () => {
    mocks.getDebateJob
      .mockResolvedValueOnce(tournament())
      .mockResolvedValueOnce(
        tournament({ status: "failed", error: "Judge generation failed" }),
      )
    mocks.subscribeToDebateJob.mockImplementation(async function* (
      _id: string,
      signal?: AbortSignal,
    ) {
      await Promise.resolve()
      yield { type: "updated" as const }
      await new Promise<void>((resolve) => {
        if (signal?.aborted) resolve()
        else signal?.addEventListener("abort", () => resolve(), { once: true })
      })
    })

    renderDebates("/debates/debate-id")

    expect((await screen.findAllByText("Debate failed")).length).toBeGreaterThan(0)
    expect(
      screen.getByText(
        "The debate stopped before it could finish. Review any completed matches, or start a new debate.",
      ),
    ).toBeVisible()
    expect(screen.queryByText("Judge generation failed")).not.toBeInTheDocument()
    expect(
      screen.getByRole("link", { name: "Start a new debate" }),
    ).toHaveAttribute("href", "/debates")
    expect(mocks.getDebateJob).toHaveBeenCalledTimes(2)
  })

  it("reconnects after a subscription failure and clears the recovered error", async () => {
    let openReconnect: () => void = () => undefined
    const reconnectOpened = new Promise<void>((resolve) => {
      openReconnect = resolve
    })
    mocks.subscribeToDebateJob
      .mockImplementationOnce(async function* () {
        await Promise.resolve()
        yield { type: "updated" as const }
        throw new Error("Connection lost")
      })
      .mockImplementationOnce(async function* (
        _id: string,
        signal?: AbortSignal,
        onOpen?: () => void,
      ) {
        await reconnectOpened
        onOpen?.()
        await new Promise<void>((resolve) => {
          if (signal?.aborted) resolve()
          else signal?.addEventListener("abort", () => resolve(), { once: true })
        })
        yield* []
      })

    renderDebates("/debates/debate-id")

    expect(
      await screen.findByText(
        "Live updates were interrupted. Reconnecting…",
      ),
    ).toBeVisible()
    await waitFor(() =>
      expect(mocks.subscribeToDebateJob).toHaveBeenCalledTimes(2),
    )
    openReconnect()
    await waitFor(() =>
      expect(
        screen.queryByText("Live updates were interrupted. Reconnecting…"),
      ).not.toBeInTheDocument(),
    )
  })

  it("hides a stale subscription error after a terminal snapshot refetch", async () => {
    let resolveTerminalSnapshot: (
      snapshot: DebateTournamentSnapshot,
    ) => void = () => undefined
    const terminalSnapshot = new Promise<DebateTournamentSnapshot>((resolve) => {
      resolveTerminalSnapshot = resolve
    })
    mocks.getDebateJob
      .mockResolvedValueOnce(tournament())
      .mockReturnValueOnce(terminalSnapshot)
    mocks.subscribeToDebateJob.mockImplementation(async function* () {
      await Promise.resolve()
      yield { type: "updated" as const }
      throw new Error("Connection lost at completion")
    })

    renderDebates("/debates/debate-id")

    expect(
      await screen.findByText(
        "Live updates were interrupted. Reconnecting…",
      ),
    ).toBeVisible()
    resolveTerminalSnapshot(
      tournament({ status: "completed", stage: "final" }),
    )

    expect(await screen.findByText("Debate complete")).toBeVisible()
    expect(
      screen.queryByText("Live updates were interrupted. Reconnecting…"),
    ).not.toBeInTheDocument()
  })

  it("reconnects when a running subscription ends without done", async () => {
    mocks.subscribeToDebateJob
      .mockImplementationOnce(async function* () {
        await Promise.resolve()
        yield* []
      })
      .mockImplementationOnce(async function* (
        _id: string,
        signal?: AbortSignal,
      ) {
        yield { type: "updated" as const }
        await new Promise<void>((resolve) => {
          if (signal?.aborted) resolve()
          else signal?.addEventListener("abort", () => resolve(), { once: true })
        })
      })

    renderDebates("/debates/debate-id")

    await waitFor(() =>
      expect(mocks.subscribeToDebateJob).toHaveBeenCalledTimes(2),
    )
  })

  it("does not duplicate the option generator navigation", () => {
    renderDebates()
    expect(
      screen.queryByRole("link", { name: "Only generate options" }),
    ).not.toBeInTheDocument()
  })

  it("links to durable previous tournaments", async () => {
    mocks.getDebateJobs.mockResolvedValue([
      {
        debateJobId: "previous-debate",
        ideaJobId: "previous-ideas",
        title: "Previous Tournament",
        slug: "previous-tournament",
        prompt: "A previous tournament prompt",
        isPublic: false,
        stage: "final",
        status: "completed",
        error: null,
        createdAt: new Date("2026-08-04T12:00:00.000Z"),
        completedAt: new Date("2026-08-04T12:30:00.000Z"),
      },
    ])

    renderDebates()

    const previousDebate = await screen.findByRole("link", {
      name: /Previous Tournament/,
    })
    expect(previousDebate).toHaveAttribute("href", "/debates/previous-tournament")
    expect(within(previousDebate).getByText(/2026/)).toBeVisible()
    expect(screen.getByText("Debate complete")).toBeVisible()
  })
})
