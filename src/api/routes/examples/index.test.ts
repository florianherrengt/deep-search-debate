import { Hono } from "hono"
import { beforeEach, describe, expect, it } from "vitest"

import { db } from "../../db/index.ts"
import {
  debateJobs as debateJobsTable,
  ideaJobs as ideaJobsTable,
} from "../../db/schema/index.ts"
import type { AppEnv } from "../../types/auth.ts"
import { DEBATE_TOURNAMENT_FORMAT } from "../debates/tournament.ts"
import { exampleDebateReads } from "./index.ts"

const firstDebateId = "11111111-1111-4111-8111-111111111111"
const secondDebateId = "22222222-2222-4222-8222-222222222222"
const privateDebateId = "33333333-3333-4333-8333-333333333333"
const runningDebateId = "44444444-4444-4444-8444-444444444444"
const missingDebateId = "55555555-5555-4555-8555-555555555555"

function insertDebate(options: {
  debateJobId: string
  isPublic: boolean
  slug: string
  status: "completed" | "running"
  title: string
}): void {
  const completed = options.status === "completed"
  db.insert(debateJobsTable)
    .values({
      completedAt: completed ? new Date() : undefined,
      debateJobId: options.debateJobId,
      isPublic: options.isPublic,
      randomSeed: 1,
      stage: completed ? "final" : "ideas",
      status: options.status,
      userId: "test-user-id",
    })
    .run()
  db.insert(ideaJobsTable)
    .values({
      debateJobId: options.debateJobId,
      deepSearchCount: 2,
      maxSearches: 3,
      maxResultsPerSearch: 3,
      maxRounds: 3,
      ideaJobId: crypto.randomUUID(),
      numberOfIdeas: DEBATE_TOURNAMENT_FORMAT.participantCount,
      prompt: `Prompt for ${options.title}`,
      slug: options.slug,
      title: options.title,
      userId: "test-user-id",
    })
    .run()
}

describe("example debate reads", () => {
  beforeEach(() => {
    db.delete(debateJobsTable).run()
  })

  it("returns configured completed public debates in configured order", async () => {
    insertDebate({
      debateJobId: firstDebateId,
      isPublic: true,
      slug: "first-example",
      status: "completed",
      title: "First example",
    })
    insertDebate({
      debateJobId: secondDebateId,
      isPublic: true,
      slug: "second-example",
      status: "completed",
      title: "Second example",
    })
    insertDebate({
      debateJobId: privateDebateId,
      isPublic: false,
      slug: "private-example",
      status: "completed",
      title: "Private example",
    })
    insertDebate({
      debateJobId: runningDebateId,
      isPublic: true,
      slug: "running-example",
      status: "running",
      title: "Running example",
    })
    const app = new Hono<AppEnv>()
    exampleDebateReads(app, [
      secondDebateId,
      missingDebateId,
      privateDebateId,
      runningDebateId,
      firstDebateId,
    ])

    const response = await app.request("/examples")

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toEqual({
      debates: [
        {
          debateJobId: secondDebateId,
          prompt: "Prompt for Second example",
          slug: "second-example",
          title: "Second example",
        },
        {
          debateJobId: firstDebateId,
          prompt: "Prompt for First example",
          slug: "first-example",
          title: "First example",
        },
      ],
    })
  })

  it("returns an empty public response when no examples are configured", async () => {
    const app = new Hono<AppEnv>()
    exampleDebateReads(app, [])

    await expect((await app.request("/examples")).json()).resolves.toEqual({
      debates: [],
    })
  })
})
