import { afterEach, describe, expect, it, vi } from "vitest"
import { getIdeaJob, getIdeaJobs } from "./ideaJobs.ts"

describe("idea jobs client", () => {
  afterEach(() => vi.unstubAllGlobals())

  it("validates and transforms durable job timestamps", async () => {
    const job = {
      ideaJobId: "idea-id",
      title: "Generate Ideas",
      slug: "generate-ideas",
      prompt: "Generate ideas",
      stage: "ideas",
      numberOfIdeas: 8,
      deepSearchCount: 2,
      status: "completed",
      stopRequested: false,
      error: null,
      createdAt: "2026-08-04T12:00:00.000Z",
      completedAt: "2026-08-04T12:30:00.000Z",
    }
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(Response.json({ ideaJobs: [job] })),
    )

    await expect(getIdeaJobs()).resolves.toEqual([
      {
        ...job,
        createdAt: new Date(job.createdAt),
        completedAt: new Date(job.completedAt),
      },
    ])
  })

  it("parses inherited public visibility on a detail response", async () => {
    const job = {
      ideaJobId: "idea-id",
      title: "Generate Ideas",
      slug: "generate-ideas",
      prompt: "Generate ideas",
      stage: "ideas",
      numberOfIdeas: 12,
      deepSearchCount: 2,
      status: "completed",
      stopRequested: false,
      canResume: false,
      canStop: false,
      creditsUsed: 0,
      error: null,
      feedback: null,
      isIndexable: true,
      isPublic: true,
      createdAt: "2026-08-04T12:00:00.000Z",
      completedAt: "2026-08-04T12:30:00.000Z",
    }
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(Response.json({ ideaJob: job })),
    )

    await expect(getIdeaJob("generate-ideas")).resolves.toEqual({
      ...job,
      createdAt: new Date(job.createdAt),
      completedAt: new Date(job.completedAt),
    })
  })

  it("rejects malformed credit usage on a detail response", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        Response.json({
          ideaJob: {
            ideaJobId: "idea-id",
            title: "Generate Ideas",
            slug: "generate-ideas",
            prompt: "Generate ideas",
            stage: "ideas",
            numberOfIdeas: 12,
            deepSearchCount: 2,
            status: "completed",
            stopRequested: false,
            canResume: false,
            canStop: false,
            error: null,
            creditsUsed: 0.5,
            feedback: null,
            isIndexable: false,
            isPublic: false,
            createdAt: "2026-08-04T12:00:00.000Z",
            completedAt: "2026-08-04T12:30:00.000Z",
          },
        }),
      ),
    )

    await expect(getIdeaJob("generate-ideas")).rejects.toThrow()
  })

  it("rejects malformed durable job timestamps", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        Response.json({
          ideaJobs: [
            {
              ideaJobId: "idea-id",
              title: "Generate Ideas",
              slug: "generate-ideas",
              prompt: "Generate ideas",
              stage: "ideas",
              numberOfIdeas: 12,
              deepSearchCount: 2,
              status: "running",
              error: null,
              createdAt: "not-an-iso-timestamp",
              completedAt: null,
            },
          ],
        }),
      ),
    )

    await expect(getIdeaJobs()).rejects.toThrow()
  })
})
