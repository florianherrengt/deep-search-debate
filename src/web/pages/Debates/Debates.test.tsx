import { fireEvent, render, screen, waitFor } from "@testing-library/react"
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { MemoryRouter, Route, Routes } from "react-router-dom"
import { beforeEach, describe, expect, it, vi } from "vitest"
import type { DebateTournamentSnapshot } from "../../lib/debateJobs.ts"

const mocks = vi.hoisted(() => ({
  createDebateJob: vi.fn(),
  getDebateJob: vi.fn(),
  getDebateJobs: vi.fn(),
  subscribeToDebateJob: vi.fn(),
  subscribeToTextStream: vi.fn(),
}))

vi.mock("../../lib/debateJobs.ts", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../lib/debateJobs.ts")>()),
  createDebateJob: mocks.createDebateJob,
  getDebateJob: mocks.getDebateJob,
  getDebateJobs: mocks.getDebateJobs,
  subscribeToDebateJob: mocks.subscribeToDebateJob,
}))

vi.mock("../../lib/textStreams.ts", () => ({
  subscribeToTextStream: mocks.subscribeToTextStream,
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
    prompt: "Design a better café",
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
          <Route path="/debates/:debateJobId" element={<Debates />} />
          <Route path="/ideas" element={<div>Idea generator</div>} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  )
}

describe("Debates", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.createDebateJob.mockResolvedValue("debate-id")
    mocks.getDebateJob.mockResolvedValue(tournament())
    mocks.getDebateJobs.mockResolvedValue([])
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
    mocks.subscribeToTextStream.mockImplementation(async function* () {
      await Promise.resolve()
      yield { type: "text" as const, text: "Live opening argument" }
      yield { type: "done" as const }
    })
  })

  it("starts a tournament and streams its active transcript", async () => {
    renderDebates()

    fireEvent.change(screen.getByLabelText("What should the ideas solve?"), {
      target: { value: "  Design a better café  " },
    })
    fireEvent.click(screen.getByRole("button", { name: "Start tournament" }))

    expect(await screen.findByText("Live opening argument")).toBeVisible()
    expect(
      screen.getByRole("link", {
        name: "View the underlying idea generation",
      }),
    ).toHaveAttribute("href", "/ideas/idea-job-id")
    expect(mocks.createDebateJob).toHaveBeenCalledWith("Design a better café")
    expect(mocks.getDebateJob).toHaveBeenCalledWith(
      "debate-id",
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

  it("prefills a question handed off from the landing page", () => {
    renderDebates("/debates?prompt=Should%20we%20enter%20this%20market%3F")

    expect(screen.getByLabelText("What should the ideas solve?")).toHaveValue(
      "Should we enter this market?",
    )
  })

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

    renderDebates("/debates/debate-id")

    expect(
      await screen.findByRole("heading", { name: "First idea" }),
    ).toBeVisible()
    expect(screen.getByText("The first idea is more practical.")).toBeVisible()
    expect(
      screen.getByRole("link", {
        name: "View the underlying idea generation",
      }),
    ).toHaveAttribute("href", "/ideas/idea-job-id")
    await waitFor(() => expect(mocks.subscribeToDebateJob).not.toHaveBeenCalled())
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

    expect(await screen.findByText("Tournament failed")).toBeVisible()
    expect(
      screen.getByText(
        "The tournament stopped before it could finish. You can review the completed matches below or start a new tournament.",
      ),
    ).toBeVisible()
    expect(screen.queryByText("Judge generation failed")).not.toBeInTheDocument()
    expect(
      screen.getByRole("link", { name: "Start a new tournament" }),
    ).toHaveAttribute("href", "/debates")
    expect(mocks.getDebateJob).toHaveBeenCalledTimes(2)
  })

  it("reconnects after a subscription failure and clears the recovered error", async () => {
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

    expect(await screen.findByText("Tournament complete")).toBeVisible()
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

  it("links to the standalone idea generator", () => {
    renderDebates()
    expect(
      screen.getByRole("link", { name: "Open the idea generator instead" }),
    ).toHaveAttribute("href", "/ideas")
  })

  it("links to durable previous tournaments", async () => {
    mocks.getDebateJobs.mockResolvedValue([
      {
        debateJobId: "previous-debate",
        ideaJobId: "previous-ideas",
        prompt: "A previous tournament prompt",
        stage: "final",
        status: "completed",
        error: null,
        createdAt: new Date("2026-08-04T12:00:00.000Z"),
        completedAt: new Date("2026-08-04T12:30:00.000Z"),
      },
    ])

    renderDebates()

    expect(
      await screen.findByRole("link", { name: /A previous tournament prompt/ }),
    ).toHaveAttribute("href", "/debates/previous-debate")
    expect(screen.getByText("Tournament complete")).toBeVisible()
  })
})
