import { eq } from "drizzle-orm"
import { HTTPException } from "hono/http-exception"
import { beforeEach, describe, expect, it } from "vitest"

import { config } from "../config.ts"
import { db } from "../db/index.ts"
import {
  debateJobs,
  deepSearchJobs,
  researchJobAdmissions,
} from "../db/schema/index.ts"
import { reserveRootResearchCapacity } from "./researchCapacity.ts"

describe("root research admission", () => {
  beforeEach(() => {
    db.delete(debateJobs).run()
    db.delete(deepSearchJobs).run()
    db.delete(researchJobAdmissions).run()
  })

  it("keeps a charged admission after the pending reservation is released", () => {
    const release = reserveRootResearchCapacity(
      "test-user-id",
      "deep-search",
    )

    release()

    expect(db.select().from(researchJobAdmissions).all()).toHaveLength(1)
  })

  it("returns Retry-After when a workflow kind reaches its rolling quota", () => {
    db.insert(researchJobAdmissions)
      .values(
        Array.from(
          {
            length: config.abuseProtection.maxDebateCreationsPerWindow,
          },
          (_, position) => ({
            researchJobAdmissionId: `debate-admission-${position}`,
            userId: "test-user-id",
            kind: "debate" as const,
          }),
        ),
      )
      .run()

    let rejection: unknown
    try {
      reserveRootResearchCapacity("test-user-id", "debate")
    } catch (error) {
      rejection = error
    }

    expect(rejection).toBeInstanceOf(HTTPException)
    const response = (rejection as HTTPException).getResponse()
    expect(response.status).toBe(429)
    expect(Number(response.headers.get("Retry-After"))).toBeGreaterThan(0)
  })

  it("applies the combined root-workflow quota across job kinds", () => {
    const kinds = ["deep-search", "idea", "debate"] as const
    db.insert(researchJobAdmissions)
      .values(
        Array.from(
          {
            length: config.abuseProtection.maxRootJobCreationsPerWindow,
          },
          (_, position) => ({
            researchJobAdmissionId: `root-admission-${position}`,
            userId: "test-user-id",
            kind: kinds[position % kinds.length] ?? "deep-search",
          }),
        ),
      )
      .run()

    expect(() =>
      reserveRootResearchCapacity("test-user-id", "deep-search"),
    ).toThrow(HTTPException)
  })

  it("does not count admissions outside the rolling window", () => {
    const expiredAt = new Date(
      Date.now() -
        config.abuseProtection.researchJobCreationWindowMs -
        1_000,
    )
    db.insert(researchJobAdmissions)
      .values(
        Array.from(
          {
            length: config.abuseProtection.maxDebateCreationsPerWindow,
          },
          (_, position) => ({
            researchJobAdmissionId: `expired-admission-${position}`,
            userId: "test-user-id",
            kind: "debate" as const,
            createdAt: expiredAt,
          }),
        ),
      )
      .run()

    const release = reserveRootResearchCapacity("test-user-id", "debate")
    release()

    expect(
      db
        .select()
        .from(researchJobAdmissions)
        .where(eq(researchJobAdmissions.kind, "debate"))
        .all(),
    ).toHaveLength(config.abuseProtection.maxDebateCreationsPerWindow + 1)
  })

  it("does not charge a request rejected by the active-job limit", () => {
    db.insert(deepSearchJobs)
      .values(
        Array.from(
          { length: config.deepSearch.maxActiveRootJobsPerUser },
          (_, position) => ({
            deepSearchJobId: `active-root-${position}`,
            userId: "test-user-id",
            title: `Active root ${position}`,
            slug: `active-root-${position}`,
            researchRequest: "Research this",
            maxSearches: 1,
            maxResultsPerSearch: 1,
          }),
        ),
      )
      .run()

    expect(() =>
      reserveRootResearchCapacity("test-user-id", "deep-search"),
    ).toThrow(HTTPException)
    expect(db.select().from(researchJobAdmissions).all()).toEqual([])
  })
})
