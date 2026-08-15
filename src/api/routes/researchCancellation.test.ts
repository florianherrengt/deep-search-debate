import { eq } from "drizzle-orm"
import { beforeEach, describe, expect, it } from "vitest"

import { db } from "../db/index.ts"
import {
  debateJobs,
  deepSearchJobs,
  ideaJobs,
  user,
} from "../db/schema/index.ts"
import { requestDebateStop } from "./debates/cancellation.ts"
import { requestDeepSearchStop } from "./deepSearch/cancellation.ts"
import { requestIdeaStop } from "./ideas/cancellation.ts"
import {
  assertEffectiveResearchRootRunning,
  EffectiveResearchRootInactiveError,
  resolveEffectiveResearchRoot,
} from "./researchCancellation.ts"

const ownerId = "test-user-id"
const foreignUserId = "cancellation-foreign-user"

function insertDeepSearch(input: {
  ideaJobId?: string
  userId?: string
  status?: "running" | "failed" | "interrupted"
  cancelRequestedAt?: Date
} = {}): string {
  const deepSearchJobId = crypto.randomUUID()
  const status = input.status ?? "running"
  db.insert(deepSearchJobs)
    .values({
      deepSearchJobId,
      userId: input.userId ?? ownerId,
      ideaJobId: input.ideaJobId,
      ideaJobPosition: input.ideaJobId ? 0 : undefined,
      slug: `search-${deepSearchJobId}`,
      researchRequest: "Research cancellation",
      maxSearches: 1,
      maxResultsPerSearch: 1,
      status,
      cancelRequestedAt: input.cancelRequestedAt,
      completedAt: status === "running" ? undefined : new Date(),
      error: status === "running" ? undefined : "Terminal",
    })
    .run()
  return deepSearchJobId
}

function insertIdea(input: {
  debateJobId?: string
  userId?: string
} = {}): string {
  const ideaJobId = crypto.randomUUID()
  db.insert(ideaJobs)
    .values({
      ideaJobId,
      userId: input.userId ?? ownerId,
      debateJobId: input.debateJobId,
      slug: `idea-${ideaJobId}`,
      prompt: "Generate ideas",
      numberOfIdeas: 6,
      deepSearchCount: 1,
    })
    .run()
  return ideaJobId
}

function insertDebate(userId = ownerId): string {
  const debateJobId = crypto.randomUUID()
  db.insert(debateJobs)
    .values({ debateJobId, userId, randomSeed: 42 })
    .run()
  return debateJobId
}

describe("durable research cancellation", () => {
  beforeEach(() => {
    db.delete(debateJobs).run()
    db.delete(deepSearchJobs).run()
    db.delete(ideaJobs).run()
    db.insert(user)
      .values({
        id: foreignUserId,
        name: "Foreign User",
        email: "cancellation-foreign@example.com",
        emailVerified: true,
      })
      .onConflictDoNothing()
      .run()
  })

  it("persists an idempotent owner-only stop request with a checked update", () => {
    const deepSearchJobId = insertDeepSearch()

    const first = requestDeepSearchStop(ownerId, deepSearchJobId)
    const repeated = requestDeepSearchStop(ownerId, deepSearchJobId)

    expect(first).toMatchObject({ kind: "requested", newlyRequested: true })
    expect(repeated).toEqual({
      kind: "requested",
      newlyRequested: false,
      cancelRequestedAt:
        first.kind === "requested" ? first.cancelRequestedAt : undefined,
    })
    expect(requestDeepSearchStop(foreignUserId, deepSearchJobId)).toEqual({
      kind: "not-found",
    })
  })

  it("rejects nested jobs and distinguishes direct stopped roots", () => {
    const debateJobId = insertDebate()
    const ideaJobId = insertIdea({ debateJobId })
    const deepSearchJobId = insertDeepSearch({ ideaJobId })

    expect(requestIdeaStop(ownerId, ideaJobId)).toEqual({ kind: "not-root" })
    expect(requestDeepSearchStop(ownerId, deepSearchJobId)).toEqual({
      kind: "not-root",
    })

    const rootIdeaJobId = insertIdea()
    const request = requestIdeaStop(ownerId, rootIdeaJobId)
    expect(request).toMatchObject({ kind: "requested", newlyRequested: true })
    const completedAt = new Date()
    db.update(ideaJobs)
      .set({ status: "interrupted", error: "Stopped by user", completedAt })
      .where(eq(ideaJobs.ideaJobId, rootIdeaJobId))
      .run()
    expect(requestIdeaStop(ownerId, rootIdeaJobId)).toMatchObject({
      kind: "already-interrupted",
      completedAt,
    })
  })

  it("requests debate stops and rejects incompatible terminal states", () => {
    const debateJobId = insertDebate()
    const first = requestDebateStop(ownerId, debateJobId)
    expect(first).toMatchObject({
      kind: "requested",
      newlyRequested: true,
    })
    expect(requestDebateStop(ownerId, debateJobId)).toEqual({
      ...first,
      newlyRequested: false,
    })
    expect(requestDebateStop(foreignUserId, debateJobId)).toEqual({
      kind: "not-found",
    })

    const failedSearchId = insertDeepSearch({ status: "failed" })
    expect(requestDeepSearchStop(ownerId, failedSearchId)).toEqual({
      kind: "not-cancellable",
      status: "failed",
    })
  })

  it("derives debate to idea to deep-search roots and guards stopped work", () => {
    const debateJobId = insertDebate()
    const ideaJobId = insertIdea({ debateJobId })
    const deepSearchJobId = insertDeepSearch({ ideaJobId })

    db.transaction((transaction) => {
      expect(
        resolveEffectiveResearchRoot(transaction, {
          kind: "deep-search",
          jobId: deepSearchJobId,
        }),
      ).toMatchObject({ kind: "debate", jobId: debateJobId })
      expect(
        assertEffectiveResearchRootRunning(transaction, {
          kind: "idea",
          jobId: ideaJobId,
        }),
      ).toMatchObject({ kind: "debate", jobId: debateJobId })
    })

    requestDebateStop(ownerId, debateJobId)
    let thrown: unknown
    try {
      db.transaction((transaction) =>
        assertEffectiveResearchRootRunning(transaction, {
          kind: "deep-search",
          jobId: deepSearchJobId,
        }),
      )
    } catch (error) {
      thrown = error
    }
    expect(thrown).toBeInstanceOf(EffectiveResearchRootInactiveError)
    if (!(thrown instanceof EffectiveResearchRootInactiveError)) return
    expect(thrown.reason).toBe("stop-requested")
  })
})
