import { fireEvent, render, screen, waitFor } from "@testing-library/react"
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { MemoryRouter, Route, Routes } from "react-router-dom"
import { beforeEach, describe, expect, it, vi } from "vitest"

const services = vi.hoisted(() => ({
  createRefineSession: vi.fn(),
  getRefineSession: vi.fn(),
  getRefineSessions: vi.fn(),
  retryRefinePreparation: vi.fn(),
  saveRefineDraft: vi.fn(),
  startRefineResearch: vi.fn(),
  submitRefineAnswers: vi.fn(),
}))

vi.mock("./refineSessions.ts", () => services)

import { Refine, RefineSessionView } from "./index.tsx"
import type { RefineSession } from "./refineSessions.ts"

function session(overrides: Partial<RefineSession> = {}): RefineSession {
  return {
    id: "session-1",
    originalPrompt: "Which home batteries are best for renters?",
    status: "clarifying",
    prepState: "idle",
    pendingBatchId: "batch-1",
    currentBatchId: "batch-1",
    batches: [{
      id: "batch-1",
      status: "ready",
      questions: [{
        id: "question-1",
        prompt: "What matters most in your choice?",
        candidates: [
          { id: "cost", label: "Low upfront cost" },
          { id: "portable", label: "Portable installation" },
        ],
      }],
    }],
    draftAnswers: [],
    prepSearches: [],
    createdAt: new Date("2026-10-19T10:00:00Z"),
    updatedAt: new Date("2026-10-19T10:00:00Z"),
    ...overrides,
  }
}

function renderView(value: RefineSession) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } })
  const onSessionChange = vi.fn()
  render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={[`/refine/${value.id}`]}>
        <Routes>
          <Route path="/refine/:sessionId" element={<RefineSessionView session={value} onSessionChange={onSessionChange} />} />
          <Route path="/deep-search/:slug" element={<div>Deep search detail</div>} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  )
  return { onSessionChange }
}

describe("Refine", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    services.saveRefineDraft.mockImplementation((_id: string, _batchId: string, answers: unknown[]) => Promise.resolve({ ...session(), draftAnswers: answers }))
    services.submitRefineAnswers.mockImplementation((_id: string, _batchId: string, answers: unknown[]) => Promise.resolve({
      ...session({
        pendingBatchId: "batch-2",
        currentBatchId: null,
        prepState: "preparing",
        batches: [
          { ...session().batches[0], status: "submitted", answers: answers as RefineSession["batches"][number]["answers"] },
          { id: "batch-2", status: "preparing", questions: [] },
        ],
      }),
      draftAnswers: [],
    }))
    services.retryRefinePreparation.mockResolvedValue(session({ prepState: "preparing", batches: [{ id: "batch-1", status: "preparing", questions: [] }] }))
    services.startRefineResearch.mockResolvedValue(session({ status: "research-started", research: { deepSearchJobId: "research-1", slug: "battery-research" } }))
  })

  it("submits selected options and supplemental text while preserving the prior batch", async () => {
    renderView(session())

    fireEvent.click(screen.getByRole("checkbox", { name: "Portable installation" }))
    fireEvent.change(screen.getByRole("textbox", { name: "Add your own context for: What matters most in your choice?" }), { target: { value: "No landlord approval available" } })
    fireEvent.click(screen.getByRole("button", { name: "Ask more questions" }))

    await waitFor(() => expect(services.submitRefineAnswers).toHaveBeenCalledWith("session-1", "batch-1", [{
      questionId: "question-1",
      selectedCandidateIds: ["portable"],
      text: "No landlord approval available",
    }]))
    expect(services.saveRefineDraft.mock.invocationCallOrder[0]).toBeLessThan(services.submitRefineAnswers.mock.invocationCallOrder[0])
  })

  it("uses currentBatchId when the ready batch has no pendingBatchId", () => {
    const value = session({ pendingBatchId: null, currentBatchId: "batch-1" })
    renderView(value)
    expect(screen.getByRole("checkbox", { name: "Low upfront cost" })).toBeEnabled()
    expect(screen.getByRole("button", { name: "Ask more questions" })).toBeEnabled()
    expect(screen.getByRole("button", { name: "Start research" })).toBeEnabled()
  })

  it("serializes autosaves and persists the latest edit when an earlier save is still running", async () => {
    let finishFirstSave: ((value: RefineSession) => void) | undefined
    services.saveRefineDraft.mockImplementationOnce(() => new Promise((resolve) => { finishFirstSave = resolve }))
    renderView(session())

    const context = screen.getByRole("textbox", { name: "Add your own context for: What matters most in your choice?" })
    fireEvent.change(context, { target: { value: "First draft" } })
    await waitFor(() => expect(services.saveRefineDraft).toHaveBeenCalledTimes(1))
    fireEvent.change(context, { target: { value: "Latest draft" } })
    finishFirstSave?.(session({ draftAnswers: [{ questionId: "question-1", selectedCandidateIds: [], text: "First draft" }] }))

    await waitFor(() => expect(services.saveRefineDraft).toHaveBeenCalledTimes(2))
    expect(services.saveRefineDraft.mock.calls[1]?.[2]).toEqual([{ questionId: "question-1", selectedCandidateIds: [], text: "Latest draft" }])
  })

  it("keeps failed draft changes and retries the save before submitting answers", async () => {
    services.saveRefineDraft.mockRejectedValueOnce(new Error("Draft save failed"))
    renderView(session())

    fireEvent.change(screen.getByRole("textbox", { name: "Add your own context for: What matters most in your choice?" }), { target: { value: "Keep the latest answer" } })
    await waitFor(() => expect(services.saveRefineDraft).toHaveBeenCalledTimes(1))
    await waitFor(() => expect(screen.getByRole("button", { name: "Ask more questions" })).toBeEnabled())
    fireEvent.click(screen.getByRole("button", { name: "Ask more questions" }))

    await waitFor(() => expect(services.submitRefineAnswers).toHaveBeenCalledWith("session-1", "batch-1", [{ questionId: "question-1", selectedCandidateIds: [], text: "Keep the latest answer" }]))
    expect(services.saveRefineDraft).toHaveBeenCalledTimes(2)
  })

  it("locks submitted answers and Start research only while Ask more is pending", async () => {
    let finishSubmit: ((value: RefineSession) => void) | undefined
    services.submitRefineAnswers.mockImplementationOnce(() => new Promise((resolve) => { finishSubmit = resolve }))
    renderView(session())

    const start = screen.getByRole("button", { name: "Start research" })
    fireEvent.click(screen.getByRole("button", { name: "Ask more questions" }))
    await waitFor(() => expect(services.submitRefineAnswers).toHaveBeenCalled())

    expect(screen.getByRole("checkbox", { name: "Portable installation" })).toBeDisabled()
    expect(screen.getByRole("textbox", { name: "Add your own context for: What matters most in your choice?" })).toBeDisabled()
    expect(start).toBeDisabled()
    finishSubmit?.(session({ prepState: "preparing", currentBatchId: null, batches: [{ id: "batch-2", status: "preparing", questions: [] }] }))
    await waitFor(() => expect(start).toBeEnabled())
  })

  it("allows starting research while questions are being prepared, including an unanswered batch", async () => {
    renderView(session({ prepState: "preparing", currentBatchId: null, batches: [{ id: "batch-1", status: "preparing", questions: [] }] }))

    const start = screen.getByRole("button", { name: "Start research" })
    expect(start).toBeEnabled()
    fireEvent.click(start)

    await waitFor(() => expect(services.startRefineResearch).toHaveBeenCalledWith("session-1", "batch-1", []))
    expect(await screen.findByText("Deep search detail")).toBeVisible()
  })

  it("retries a failed research handoff with the immutable submitted answers", async () => {
    const savedAnswers = [{ questionId: "question-1", selectedCandidateIds: ["portable"], text: "No landlord approval" , unanswered: false }]
    const submitted = session({
      pendingBatchId: "batch-1",
      currentBatchId: null,
      batches: [{ ...session().batches[0], status: "submitted", answers: savedAnswers }],
    })
    services.startRefineResearch.mockRejectedValueOnce(new Error("Research start failed"))
    services.startRefineResearch.mockResolvedValueOnce(session({ status: "research-started", research: { deepSearchJobId: "research-1", slug: "battery-research" } }))
    renderView(submitted)

    fireEvent.click(screen.getByRole("button", { name: "Start research" }))
    await waitFor(() => expect(services.startRefineResearch).toHaveBeenCalledTimes(1))
    expect(services.saveRefineDraft).not.toHaveBeenCalled()
    expect(services.startRefineResearch).toHaveBeenNthCalledWith(1, "session-1", "batch-1", [
      { questionId: "question-1", selectedCandidateIds: ["portable"], text: "No landlord approval" },
    ])

    fireEvent.click(screen.getByRole("button", { name: "Start research" }))
    await waitFor(() => expect(services.startRefineResearch).toHaveBeenCalledTimes(2))
    expect(services.startRefineResearch).toHaveBeenNthCalledWith(2, "session-1", "batch-1", [
      { questionId: "question-1", selectedCandidateIds: ["portable"], text: "No landlord approval" },
    ])
  })

  it("lets users retry a failed preparation and keeps Start research available", async () => {
    let finishRetry: ((value: RefineSession) => void) | undefined
    services.retryRefinePreparation.mockImplementation(() => new Promise((resolve) => { finishRetry = resolve }))
    renderView(session({ prepState: "failed", batches: [{ id: "batch-1", status: "failed", questions: [] }] }))

    fireEvent.click(screen.getByRole("button", { name: "Retry question preparation" }))

    await waitFor(() => expect(services.retryRefinePreparation).toHaveBeenCalledWith("session-1", "batch-1"))
    expect(screen.getByRole("button", { name: "Start research" })).toBeEnabled()
    finishRetry?.(session({ prepState: "preparing", batches: [{ id: "batch-1", status: "preparing", questions: [] }] }))
  })

  it("shows newly prepared questions after the saved session was still preparing", async () => {
    const preparing = session({ prepState: "preparing", currentBatchId: null, batches: [{ id: "batch-1", status: "preparing", questions: [] }] })
    services.getRefineSession.mockResolvedValueOnce(preparing).mockResolvedValue(session())
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } })
    render(
      <QueryClientProvider client={queryClient}>
        <MemoryRouter initialEntries={["/refine/session-1"]}>
          <Routes><Route path="/refine/:sessionId" element={<Refine />} /></Routes>
        </MemoryRouter>
      </QueryClientProvider>,
    )

    expect(await screen.findByText("Preparing questions…")).toBeVisible()
    expect(await screen.findByText("Low upfront cost", {}, { timeout: 4_000 })).toBeVisible()
  })

  it("shows submitted answers as read-only and links to the resulting research", () => {
    renderView(session({
      status: "research-started",
      research: { deepSearchJobId: "research-1", slug: "battery-research" },
      batches: [{
        id: "batch-1",
        status: "submitted",
        questions: session().batches[0].questions,
        answers: [{ questionId: "question-1", selectedCandidateIds: [], text: "", unanswered: true }],
      }],
    }))

    expect(screen.getByText("Unanswered")).toBeVisible()
    expect(screen.queryByRole("button", { name: "Ask more questions" })).not.toBeInTheDocument()
    expect(screen.getByRole("link", { name: "Open research" })).toHaveAttribute("href", "/deep-search/battery-research")
  })

  it("starts a session from the prompt form and opens its saved detail URL", async () => {
    services.getRefineSessions.mockResolvedValue([])
    services.createRefineSession.mockResolvedValue(session({ prepState: "preparing", currentBatchId: null, batches: [{ id: "batch-1", status: "preparing", questions: [] }] }))
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } })
    render(
      <QueryClientProvider client={queryClient}>
        <MemoryRouter initialEntries={["/refine"]}>
          <Routes>
            <Route path="/refine" element={<Refine />} />
            <Route path="/refine/:sessionId" element={<div>Saved Refine session</div>} />
          </Routes>
        </MemoryRouter>
      </QueryClientProvider>,
    )

    const start = screen.getByRole("button", { name: "Start refining" })
    expect(start).toBeDisabled()
    fireEvent.change(screen.getByRole("textbox", { name: "What would you like to research?" }), { target: { value: "Battery storage for renters" } })
    fireEvent.click(start)

    expect(await screen.findByText("Saved Refine session")).toBeVisible()
    expect(services.createRefineSession).toHaveBeenCalledWith("Battery storage for renters")
  })
})
