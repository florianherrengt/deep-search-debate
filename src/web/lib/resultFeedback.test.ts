import { afterEach, describe, expect, it, vi } from "vitest"
import { updateResultFeedback } from "./resultFeedback.ts"

describe("result feedback client", () => {
  afterEach(() => vi.unstubAllGlobals())

  it.each([
    ["deep-search" as const, "deep-search-jobs"],
    ["idea" as const, "idea-jobs"],
    ["debate" as const, "debate-jobs"],
  ])("updates %s feedback through its job endpoint", async (resource, path) => {
    const fetchMock = vi.fn().mockResolvedValue(
      Response.json({
        feedback: { rating: false, hasWrittenFeedback: false },
      }),
    )
    vi.stubGlobal("fetch", fetchMock)

    await expect(
      updateResultFeedback(resource, "job/id", {
        type: "rating",
        rating: false,
      }),
    ).resolves.toEqual({ rating: false, hasWrittenFeedback: false })
    expect(fetchMock).toHaveBeenCalledWith(
      `/api/${path}/job%2Fid/feedback`,
      {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ type: "rating", rating: false }),
        signal: undefined,
      },
    )
  })

  it("trims written feedback and rejects empty text before requesting", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      Response.json({
        feedback: { rating: false, hasWrittenFeedback: true },
      }),
    )
    vi.stubGlobal("fetch", fetchMock)

    await updateResultFeedback("idea", "idea-id", {
      type: "text",
      text: "  More recent evidence, please.  ",
    })
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/idea-jobs/idea-id/feedback",
      expect.objectContaining({
        body: JSON.stringify({
          type: "text",
          text: "More recent evidence, please.",
        }),
      }),
    )

    await expect(
      updateResultFeedback("idea", "idea-id", {
        type: "text",
        text: "   ",
      }),
    ).rejects.toThrow()
    expect(fetchMock.mock.calls).toHaveLength(1)
  })

  it("rejects malformed feedback responses", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(Response.json({ feedback: { rating: "up" } })),
    )

    await expect(
      updateResultFeedback("debate", "debate-id", {
        type: "rating",
        rating: true,
      }),
    ).rejects.toThrow()
  })
})
