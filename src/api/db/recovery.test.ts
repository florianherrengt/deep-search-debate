import { eq } from "drizzle-orm"
import { beforeEach, describe, expect, it, vi } from "vitest"

import { db } from "./index.ts"
import {
  loadPersistedResearchRoots,
  reconcilePersistedResearchRoots,
} from "./recovery.ts"
import {
  debateJobs,
  deepSearchJobs,
  ideaJobs,
  llmGenerations,
} from "./schema/index.ts"

type RootOptions = {
  createdAt?: Date
  id?: string
}

function addDebate(
  status: "running" | "completed",
  options: RootOptions = {},
) {
  const debateJobId = options.id ?? crypto.randomUUID()
  const ideaJobId = crypto.randomUUID()
  db.insert(debateJobs)
    .values({
      debateJobId,
      userId: "test-user-id",
      randomSeed: 42,
      stage: status === "completed" ? "final" : "ideas",
      createdAt: options.createdAt,
    })
    .run()
  db.insert(ideaJobs)
    .values({
      ideaJobId,
      debateJobId,
      userId: "test-user-id",
      title: `Debate ${debateJobId}`,
      slug: `debate-${debateJobId}`,
      prompt: "Debate prompt",
      numberOfIdeas: 6,
      deepSearchCount: 1,
      maxSearches: 1,
      maxResultsPerSearch: 1,
      maxRounds: 1,
      status: "running",
    })
    .run()
  const deepSearchJobId = addDeepSearch("running", ideaJobId)
  if (status === "completed") {
    const websiteGenerationId = crypto.randomUUID()
    const completedAt = new Date()
    db.insert(llmGenerations)
      .values({
        llmGenerationId: websiteGenerationId,
        userId: "test-user-id",
        debateJobId,
        status: "completed",
        text: "Persisted winner website",
        reasoning: "",
        completedAt,
      })
      .run()
    db.update(debateJobs)
      .set({
        websiteGenerationId,
        status: "completed",
        completedAt,
      })
      .where(eq(debateJobs.debateJobId, debateJobId))
      .run()
  }
  return { debateJobId, ideaJobId, deepSearchJobId }
}

function addIdea(
  status: "interrupted" | "completed",
  options: RootOptions = {},
) {
  const ideaJobId = options.id ?? crypto.randomUUID()
  db.insert(ideaJobs)
    .values({
      ideaJobId,
      userId: "test-user-id",
      title: `Idea ${ideaJobId}`,
      slug: `idea-${ideaJobId}`,
      prompt: "Idea prompt",
      numberOfIdeas: 2,
      deepSearchCount: 1,
      maxSearches: 1,
      maxResultsPerSearch: 1,
      maxRounds: 1,
      status: status === "completed" ? "running" : status,
      createdAt: options.createdAt,
      completedAt: status === "completed" ? null : new Date(),
      error: status === "interrupted" ? "Stopped" : null,
    })
    .run()
  if (status === "completed") {
    const generationIds = Array.from({ length: 4 }, () => crypto.randomUUID())
    const completedAt = new Date()
    db.insert(llmGenerations)
      .values(
        generationIds.map((llmGenerationId) => ({
          llmGenerationId,
          userId: "test-user-id",
          ideaJobId,
          status: "completed" as const,
          text: "Persisted output",
          reasoning: "",
          completedAt,
        })),
      )
      .run()
    db.update(ideaJobs)
      .set({
        stage: "ideas",
        status: "completed",
        researchPromptGenerationId: generationIds[0],
        researchSummaryGenerationId: generationIds[1],
        ideaGenerationId: generationIds[2],
        selectionGenerationId: generationIds[3],
        completedAt,
      })
      .where(eq(ideaJobs.ideaJobId, ideaJobId))
      .run()
  }
  return ideaJobId
}

function addDeepSearch(
  status: "running" | "failed" | "completed",
  ideaJobId: string | null = null,
  options: RootOptions = {},
) {
  const deepSearchJobId = options.id ?? crypto.randomUUID()
  db.insert(deepSearchJobs)
    .values({
      deepSearchJobId,
      ideaJobId,
      ideaJobPosition: ideaJobId === null ? null : 0,
      userId: "test-user-id",
      title: `Search ${deepSearchJobId}`,
      slug: `search-${deepSearchJobId}`,
      researchRequest: "Research prompt",
      maxSearches: 1,
      maxResultsPerSearch: 1,
      maxRounds: 1,
      strictQuality: ideaJobId !== null,
      status: status === "completed" ? "running" : status,
      createdAt: options.createdAt,
      completedAt: status === "running" || status === "completed" ? null : new Date(),
      error: status === "failed" ? "Provider failed" : null,
    })
    .run()
  if (status === "completed") {
    const generationId = crypto.randomUUID()
    const completedAt = new Date()
    db.insert(llmGenerations)
      .values({
        llmGenerationId: generationId,
        userId: "test-user-id",
        deepSearchJobId,
        status: "completed",
        text: "Persisted final answer",
        reasoning: "",
        completedAt,
      })
      .run()
    db.update(deepSearchJobs)
      .set({
        status: "completed",
        finalAnswerGenerationId: generationId,
        completedAt,
      })
      .where(eq(deepSearchJobs.deepSearchJobId, deepSearchJobId))
      .run()
  }
  return deepSearchJobId
}

describe("persisted research startup reconciliation", () => {
  beforeEach(() => {
    db.delete(debateJobs).run()
    db.delete(ideaJobs).run()
    db.delete(deepSearchJobs).run()
  })

  it("schedules non-completed effective roots and never their descendants", () => {
    const debate = addDebate("running")
    const standaloneIdeaId = addIdea("interrupted")
    const ideaChildId = addDeepSearch("failed", standaloneIdeaId)
    const standaloneDeepSearchId = addDeepSearch("failed")
    const completedDebate = addDebate("completed")
    const completedIdeaId = addIdea("completed")
    const completedDeepSearchId = addDeepSearch("completed")

    expect(loadPersistedResearchRoots()).toEqual({
      debateJobIds: [debate.debateJobId],
      ideaJobIds: [standaloneIdeaId],
      deepSearchJobIds: [standaloneDeepSearchId],
    })

    const resumeDebate = vi.fn(() => ({
      debateJobId: debate.debateJobId,
      title: "Debate",
      slug: "debate",
      completion: Promise.resolve(),
    }))
    const resumeIdea = vi.fn(() => ({
      ideaJobId: standaloneIdeaId,
      title: "Idea",
      slug: "idea",
      completion: Promise.resolve(),
    }))
    const resumeDeepSearch = vi.fn(() => ({
      deepSearchJobId: standaloneDeepSearchId,
      title: "Search",
      slug: "search",
      completion: Promise.resolve("Persisted final answer"),
    }))

    expect(
      reconcilePersistedResearchRoots({
        debates: { resumeExisting: resumeDebate },
        ideas: { resumeExisting: resumeIdea },
        deepSearches: { resumeExisting: resumeDeepSearch },
      }),
    ).toEqual({
      debateJobIds: [debate.debateJobId],
      ideaJobIds: [standaloneIdeaId],
      deepSearchJobIds: [standaloneDeepSearchId],
    })
    expect(resumeDebate).toHaveBeenCalledExactlyOnceWith(debate.debateJobId)
    expect(resumeIdea).toHaveBeenCalledExactlyOnceWith(standaloneIdeaId)
    expect(resumeDeepSearch).toHaveBeenCalledExactlyOnceWith(
      standaloneDeepSearchId,
    )
    expect(resumeIdea).not.toHaveBeenCalledWith(debate.ideaJobId)
    expect(resumeDeepSearch).not.toHaveBeenCalledWith(debate.deepSearchJobId)
    expect(resumeDeepSearch).not.toHaveBeenCalledWith(ideaChildId)
    expect(resumeDebate).not.toHaveBeenCalledWith(completedDebate.debateJobId)
    expect(resumeIdea).not.toHaveBeenCalledWith(completedIdeaId)
    expect(resumeDeepSearch).not.toHaveBeenCalledWith(completedDeepSearchId)
  })

  it("fails reconciliation when an effective root cannot be scheduled", () => {
    const debate = addDebate("running")
    const resumeExisting = vi.fn(() => {
      throw new Error("queue unavailable")
    })

    expect(() =>
      reconcilePersistedResearchRoots({
        debates: { resumeExisting },
        ideas: {
          resumeExisting: vi.fn(() => {
            throw new Error("unexpected")
          }),
        },
        deepSearches: {
          resumeExisting: vi.fn(() => {
            throw new Error("unexpected")
          }),
        },
      }),
    ).toThrow("queue unavailable")
    expect(resumeExisting).toHaveBeenCalledExactlyOnceWith(debate.debateJobId)
  })

  it("orders equal-timestamp recoverable roots by their stable IDs", () => {
    const createdAt = new Date(Date.UTC(2026, 0, 1))
    const debateIds = ["000-debate-root", "999-debate-root"]
    const ideaIds = ["000-idea-root", "999-idea-root"]
    const deepSearchIds = ["000-search-root", "999-search-root"]

    for (const id of [...debateIds].reverse()) {
      addDebate("running", { id, createdAt })
    }
    for (const id of [...ideaIds].reverse()) {
      addIdea("interrupted", { id, createdAt })
    }
    for (const id of [...deepSearchIds].reverse()) {
      addDeepSearch("failed", null, { id, createdAt })
    }

    expect(loadPersistedResearchRoots()).toEqual({
      debateJobIds: debateIds,
      ideaJobIds: ideaIds,
      deepSearchJobIds: deepSearchIds,
    })
  })
})
