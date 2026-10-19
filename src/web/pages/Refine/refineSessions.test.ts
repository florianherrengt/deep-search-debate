import { afterEach, describe, expect, it, vi } from "vitest"
import { getRefineSession } from "./refineSessions.ts"

function sessionResponse(overrides: Record<string, unknown> = {}) {
  return {
    refineSession: {
      id: "session/id",
      originalPrompt: "Research this",
      status: "clarifying",
      prepState: "preparing",
      pendingBatchId: "batch-1",
      currentBatchId: null,
      batches: [{ id: "batch-1", status: "preparing", questions: [] }],
      draftAnswers: [],
      prepSearches: [],
      createdAt: "2026-10-19T10:00:00.000Z",
      updatedAt: "2026-10-19T10:01:00.000Z",
      ...overrides,
    },
  }
}

afterEach(() => vi.unstubAllGlobals())

describe("Refine session network boundary", () => {
  it("encodes session IDs and converts snapshot timestamps to dates", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify(sessionResponse()), { status: 200 }))
    vi.stubGlobal("fetch", fetchMock)

    const result = await getRefineSession("session/id")

    expect(fetchMock).toHaveBeenCalledWith("/api/refine-sessions/session%2Fid", { signal: undefined })
    expect(result.createdAt).toBeInstanceOf(Date)
    expect(result.updatedAt.toISOString()).toBe("2026-10-19T10:01:00.000Z")
  })

  it("rejects malformed server snapshots instead of rendering unchecked state", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify(sessionResponse({ prepState: "done" })), { status: 200 }))
    vi.stubGlobal("fetch", fetchMock)

    await expect(getRefineSession("session/id")).rejects.toThrow()
  })
})
