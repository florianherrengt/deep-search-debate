import { afterEach, describe, expect, it, vi } from "vitest"
import { requestResearchStop } from "./researchCancellation.ts"

describe("research cancellation client", () => {
  afterEach(() => vi.unstubAllGlobals())

  it.each([
    ["deep-search", "/api/deep-search-jobs/job%2Fid/cancel"],
    ["idea", "/api/idea-jobs/job%2Fid/cancel"],
    ["debate", "/api/debate-jobs/job%2Fid/cancel"],
  ] as const)("posts a typed %s cancellation request", async (kind, url) => {
    const signal = new AbortController().signal
    const fetchMock = vi.fn().mockResolvedValue(
      Response.json(
        {
          status: "cancellation-requested",
          cancelRequestedAt: "2026-08-15T00:00:00.000Z",
        },
        { status: 202 },
      ),
    )
    vi.stubGlobal("fetch", fetchMock)

    await expect(requestResearchStop(kind, "job/id", signal)).resolves.toEqual({
      status: "cancellation-requested",
      cancelRequestedAt: new Date("2026-08-15T00:00:00.000Z"),
    })
    expect(fetchMock).toHaveBeenCalledWith(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: "{}",
      signal,
    })
  })

  it("rejects an invalid success payload", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(Response.json({ status: "stopping" })),
    )

    await expect(requestResearchStop("debate", "job-id")).rejects.toThrow()
  })
})
