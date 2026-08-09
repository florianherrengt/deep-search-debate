import { eq, inArray } from "drizzle-orm"
import { beforeEach, describe, expect, it } from "vitest"

import { db } from "../db/index.ts"
import {
  debateJobs,
  deepSearchJobs,
  ideaJobs,
  llmGenerations,
  user,
} from "../db/schema/index.ts"
import {
  debateJobReadScope,
  deepSearchJobReadScope,
  ideaJobReadScope,
  llmGenerationReadScope,
} from "./readAccess.ts"

const ownerId = "read-scope-owner"
const otherUserId = "read-scope-other-user"
const privateDebateId = "read-scope-private-debate"
const publicDebateId = "read-scope-public-debate"
const privateIdeaJobId = "read-scope-private-idea"
const publicIdeaJobId = "read-scope-public-idea"
const standaloneIdeaJobId = "read-scope-standalone-idea"
const privateDeepSearchJobId = "read-scope-private-search"
const publicDeepSearchJobId = "read-scope-public-search"
const standaloneDeepSearchJobId = "read-scope-standalone-search"

const generationIds = {
  directPrivate: "read-scope-generation-direct-private",
  directPublic: "read-scope-generation-direct-public",
  ideaPrivate: "read-scope-generation-idea-private",
  ideaPublic: "read-scope-generation-idea-public",
  searchPrivate: "read-scope-generation-search-private",
  searchPublic: "read-scope-generation-search-public",
  standalone: "read-scope-generation-standalone",
} as const

function readableDebateIds(viewerUserId: string | null): string[] {
  return db
    .select({ id: debateJobs.debateJobId })
    .from(debateJobs)
    .where(debateJobReadScope(viewerUserId))
    .all()
    .map(({ id }) => id)
}

function readableIdeaJobIds(viewerUserId: string | null): string[] {
  return db
    .select({ id: ideaJobs.ideaJobId })
    .from(ideaJobs)
    .where(ideaJobReadScope(viewerUserId))
    .all()
    .map(({ id }) => id)
}

function readableDeepSearchJobIds(viewerUserId: string | null): string[] {
  return db
    .select({ id: deepSearchJobs.deepSearchJobId })
    .from(deepSearchJobs)
    .where(deepSearchJobReadScope(viewerUserId))
    .all()
    .map(({ id }) => id)
}

function readableGenerationIds(viewerUserId: string | null): string[] {
  return db
    .select({ id: llmGenerations.llmGenerationId })
    .from(llmGenerations)
    .where(llmGenerationReadScope(viewerUserId))
    .all()
    .map(({ id }) => id)
}

beforeEach(() => {
  db.delete(user).where(inArray(user.id, [ownerId, otherUserId])).run()
  db.insert(user)
    .values([
      {
        id: ownerId,
        name: "Read Scope Owner",
        email: "read-scope-owner@example.com",
        emailVerified: true,
      },
      {
        id: otherUserId,
        name: "Read Scope Other User",
        email: "read-scope-other@example.com",
        emailVerified: true,
      },
    ])
    .run()

  db.insert(debateJobs)
    .values([
      {
        debateJobId: privateDebateId,
        userId: ownerId,
        randomSeed: 1,
      },
      {
        debateJobId: publicDebateId,
        userId: ownerId,
        randomSeed: 2,
        isPublic: true,
      },
    ])
    .run()

  db.insert(ideaJobs)
    .values([
      {
        ideaJobId: privateIdeaJobId,
        userId: ownerId,
        debateJobId: privateDebateId,
        slug: "private-debate-ideas",
        prompt: "Private debate ideas",
        numberOfIdeas: 1,
        deepSearchCount: 1,
      },
      {
        ideaJobId: publicIdeaJobId,
        userId: ownerId,
        debateJobId: publicDebateId,
        slug: "public-debate-ideas",
        prompt: "Public debate ideas",
        numberOfIdeas: 1,
        deepSearchCount: 1,
      },
      {
        ideaJobId: standaloneIdeaJobId,
        userId: ownerId,
        slug: "standalone-ideas",
        prompt: "Standalone ideas",
        numberOfIdeas: 1,
        deepSearchCount: 1,
      },
    ])
    .run()

  db.insert(deepSearchJobs)
    .values([
      {
        deepSearchJobId: privateDeepSearchJobId,
        userId: ownerId,
        slug: "private-debate-research",
        ideaJobId: privateIdeaJobId,
        ideaJobPosition: 0,
        researchRequest: "Private debate research",
        maxSearches: 1,
        maxResultsPerSearch: 1,
      },
      {
        deepSearchJobId: publicDeepSearchJobId,
        userId: ownerId,
        slug: "public-debate-research",
        ideaJobId: publicIdeaJobId,
        ideaJobPosition: 0,
        researchRequest: "Public debate research",
        maxSearches: 1,
        maxResultsPerSearch: 1,
      },
      {
        deepSearchJobId: standaloneDeepSearchJobId,
        userId: ownerId,
        slug: "standalone-research",
        researchRequest: "Standalone research",
        maxSearches: 1,
        maxResultsPerSearch: 1,
      },
    ])
    .run()

  db.insert(llmGenerations)
    .values([
      {
        llmGenerationId: generationIds.directPrivate,
        userId: ownerId,
        debateJobId: privateDebateId,
      },
      {
        llmGenerationId: generationIds.directPublic,
        userId: ownerId,
        debateJobId: publicDebateId,
      },
      {
        llmGenerationId: generationIds.ideaPrivate,
        userId: ownerId,
        ideaJobId: privateIdeaJobId,
      },
      {
        llmGenerationId: generationIds.ideaPublic,
        userId: ownerId,
        ideaJobId: publicIdeaJobId,
      },
      {
        llmGenerationId: generationIds.searchPrivate,
        userId: ownerId,
        deepSearchJobId: privateDeepSearchJobId,
      },
      {
        llmGenerationId: generationIds.searchPublic,
        userId: ownerId,
        deepSearchJobId: publicDeepSearchJobId,
      },
      {
        llmGenerationId: generationIds.standalone,
        userId: ownerId,
      },
    ])
    .run()
})

describe("read-access scopes", () => {
  it("allows an owner to read every private and standalone resource", () => {
    expect(readableDebateIds(ownerId)).toContain(privateDebateId)
    expect(readableIdeaJobIds(ownerId)).toEqual(
      expect.arrayContaining([privateIdeaJobId, standaloneIdeaJobId]),
    )
    expect(readableDeepSearchJobIds(ownerId)).toEqual(
      expect.arrayContaining([
        privateDeepSearchJobId,
        standaloneDeepSearchJobId,
      ]),
    )
    expect(readableGenerationIds(ownerId)).toEqual(
      expect.arrayContaining([
        generationIds.directPrivate,
        generationIds.ideaPrivate,
        generationIds.searchPrivate,
        generationIds.standalone,
      ]),
    )
  })

  it.each([otherUserId, null])(
    "hides private resources from viewer %s",
    (viewerUserId) => {
      expect(readableDebateIds(viewerUserId)).not.toContain(privateDebateId)
      expect(readableIdeaJobIds(viewerUserId)).not.toContain(privateIdeaJobId)
      expect(readableDeepSearchJobIds(viewerUserId)).not.toContain(
        privateDeepSearchJobId,
      )
      expect(readableGenerationIds(viewerUserId)).toEqual(
        expect.not.arrayContaining([
          generationIds.directPrivate,
          generationIds.ideaPrivate,
          generationIds.searchPrivate,
        ]),
      )
    },
  )

  it.each([otherUserId, null])(
    "inherits public access through every supported path for viewer %s",
    (viewerUserId) => {
      expect(readableDebateIds(viewerUserId)).toContain(publicDebateId)
      expect(readableIdeaJobIds(viewerUserId)).toContain(publicIdeaJobId)
      expect(readableDeepSearchJobIds(viewerUserId)).toContain(
        publicDeepSearchJobId,
      )
      expect(readableGenerationIds(viewerUserId)).toEqual(
        expect.arrayContaining([
          generationIds.directPublic,
          generationIds.ideaPublic,
          generationIds.searchPublic,
        ]),
      )
    },
  )

  it.each([otherUserId, null])(
    "does not grant access when an optional public-debate path is missing for viewer %s",
    (viewerUserId) => {
      expect(readableIdeaJobIds(viewerUserId)).not.toContain(
        standaloneIdeaJobId,
      )
      expect(readableDeepSearchJobIds(viewerUserId)).not.toContain(
        standaloneDeepSearchJobId,
      )
      expect(readableGenerationIds(viewerUserId)).not.toContain(
        generationIds.standalone,
      )
    },
  )

  it("reflects visibility changes without changing descendant rows", () => {
    db.update(debateJobs)
      .set({ isPublic: false })
      .where(eq(debateJobs.debateJobId, publicDebateId))
      .run()

    expect(readableIdeaJobIds(null)).not.toContain(publicIdeaJobId)
    expect(readableDeepSearchJobIds(null)).not.toContain(publicDeepSearchJobId)
    expect(readableGenerationIds(null)).not.toContain(
      generationIds.searchPublic,
    )

    db.update(debateJobs)
      .set({ isPublic: true })
      .where(eq(debateJobs.debateJobId, publicDebateId))
      .run()

    expect(readableIdeaJobIds(null)).toContain(publicIdeaJobId)
    expect(readableDeepSearchJobIds(null)).toContain(publicDeepSearchJobId)
    expect(readableGenerationIds(null)).toContain(generationIds.searchPublic)
  })

  it("filters collections to owned private and inherited public resources", () => {
    expect(readableDebateIds(otherUserId)).toEqual([publicDebateId])
    expect(readableIdeaJobIds(otherUserId)).toEqual([publicIdeaJobId])
    expect(readableDeepSearchJobIds(otherUserId)).toEqual([
      publicDeepSearchJobId,
    ])
    expect(readableGenerationIds(otherUserId)).toEqual(
      expect.arrayContaining([
        generationIds.directPublic,
        generationIds.ideaPublic,
        generationIds.searchPublic,
      ]),
    )
    expect(readableGenerationIds(otherUserId)).toHaveLength(3)
  })
})
