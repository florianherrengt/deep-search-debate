import { Hono } from "hono"
import { beforeEach, describe, expect, it, vi } from "vitest"

const mocks = vi.hoisted(() => ({
  generatePromptTitle: vi.fn(),
  generateArrayStream: vi.fn(),
}))

// Provider-facing generation calls are the only mocked boundary. The route,
// manager, workflow, and SQLite persistence remain real in this test.
vi.mock("../../llms/generateText.ts", () => ({
  generatePromptTitle: mocks.generatePromptTitle,
  generateArrayStream: mocks.generateArrayStream,
}))

import { eq } from "drizzle-orm"
import { db } from "../../db/index.ts"
import { ideaJobs as ideaJobsTable } from "../../db/schema/index.ts"
import { createDeepSearchJobManager } from "../deepSearch/manager.ts"
import { ideaJobReads, ideaJobs } from "./index.ts"
import { createIdeaJobManager } from "./manager.ts"
import type { AppEnv } from "../../types/auth.ts"

function createApp() {
  const app = new Hono<AppEnv>().basePath("/api")
  app.use("*", async (c, next) => {
    c.set("userId", "test-user-id")
    c.set("viewerUserId", "test-user-id")
    await next()
  })
  const manager = createIdeaJobManager(createDeepSearchJobManager())
  ideaJobReads(app, manager)
  ideaJobs(app, manager)
  return app
}

describe("idea creation integration", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.generatePromptTitle.mockResolvedValue("Integration Ideas")
    mocks.generateArrayStream.mockRejectedValue(
      new Error("Provider boundary failure"),
    )
    db.delete(ideaJobsTable).run()
  })

  it("persists custom creation settings through the real idea workflow", async () => {
    const input = {
      prompt: "Generate practical integration ideas",
      numberOfIdeas: 6,
      deepSearchCount: 1,
      maxSearches: 1,
      maxResultsPerSearch: 1,
      maxRounds: 1,
    }

    const response = await createApp().request("/api/idea-jobs", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(input),
    })

    expect(response.status).toBe(202)
    const body = await response.json() as {
      ideaJobId: string
      slug: string
    }
    expect(body.slug).toBe("integration-ideas")
    expect(body.ideaJobId).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i,
    )
    expect(response.headers.get("Location")).toBe(
      `/api/idea-jobs/${body.slug}`,
    )

    await vi.waitFor(() => {
      const row = db
        .select()
        .from(ideaJobsTable)
        .where(eq(ideaJobsTable.ideaJobId, body.ideaJobId))
        .get()
      expect(row?.status).toBe("failed")
    })

    const persisted = db
      .select()
      .from(ideaJobsTable)
      .where(eq(ideaJobsTable.ideaJobId, body.ideaJobId))
      .get()
    expect(persisted).toMatchObject({
      ideaJobId: body.ideaJobId,
      userId: "test-user-id",
      title: "Integration Ideas",
      slug: "integration-ideas",
      ...input,
      status: "failed",
    })

    const detail = await createApp().request(`/api/idea-jobs/${body.slug}`)
    expect(detail.status).toBe(200)
    await expect(detail.json()).resolves.toMatchObject({
      ideaJob: {
        ideaJobId: body.ideaJobId,
        title: "Integration Ideas",
        slug: "integration-ideas",
        prompt: input.prompt,
        numberOfIdeas: input.numberOfIdeas,
        deepSearchCount: input.deepSearchCount,
        maxSearches: input.maxSearches,
        maxResultsPerSearch: input.maxResultsPerSearch,
        maxRounds: input.maxRounds,
        status: "failed",
      },
    })
  })
})
