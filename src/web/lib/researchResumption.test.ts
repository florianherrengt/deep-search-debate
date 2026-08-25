import { afterEach, describe, expect, it, vi } from "vitest"
import { requestResearchResume } from "./researchResumption.ts"

describe("research resumption client", () => {
  afterEach(() => vi.unstubAllGlobals())

  it.each([
    ["deep-search", "/api/deep-search-jobs/job%2Fid/resume"],
    ["idea", "/api/idea-jobs/job%2Fid/resume"],
    ["debate", "/api/debate-jobs/job%2Fid/resume"],
  ] as const)("posts a typed %s resume request", async (kind, url) => {
    const signal = new AbortController().signal
    const fetchMock = vi
      .fn()
      .mockResolvedValue(Response.json({ status: "running" }, { status: 202 }))
    vi.stubGlobal("fetch", fetchMock)

    await expect(requestResearchResume(kind, "job/id", signal)).resolves.toEqual(
      { status: "running" },
    )
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
      vi.fn().mockResolvedValue(Response.json({ status: "resuming" })),
    )

    await expect(
      requestResearchResume("debate", "job-id"),
    ).rejects.toThrow()
  })
})
