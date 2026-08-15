import { beforeEach, describe, expect, it } from "vitest"

import { db } from "../../db/index.ts"
import { debateJobs } from "../../db/schema/index.ts"
import { completeDebateJob } from "./jobLifecycle.ts"

describe("debate job lifecycle", () => {
  beforeEach(() => {
    db.delete(debateJobs).run()
  })

  it("lets a persisted Stop win the final-verdict parent completion race", () => {
    const debateJobId = crypto.randomUUID()
    db.insert(debateJobs)
      .values({
        debateJobId,
        userId: "test-user-id",
        randomSeed: 21,
        stage: "final",
        cancelRequestedAt: new Date(),
      })
      .run()

    expect(() => completeDebateJob(debateJobId)).toThrow(
      "Effective research root is stop-requested",
    )
    expect(db.select().from(debateJobs).get()).toMatchObject({
      status: "running",
      completedAt: null,
    })
  })
})
