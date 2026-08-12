import { randomUUID } from "node:crypto"
import { and, count, eq, gte, isNull } from "drizzle-orm"
import { HTTPException } from "hono/http-exception"
import { config } from "../config.ts"
import { db } from "../db/index.ts"
import {
  debateJobs,
  deepSearchJobs,
  ideaJobs,
  llmGenerations,
  researchJobAdmissions,
  type RootResearchJobKind,
} from "../db/schema/index.ts"

const pendingRootJobsByUser = new Map<string, number>()
const pendingStandaloneGenerationsByUser = new Map<string, number>()

function incrementReservation(
  reservations: Map<string, number>,
  userId: string,
): () => void {
  reservations.set(userId, (reservations.get(userId) ?? 0) + 1)
  let active = true
  return () => {
    if (!active) return
    active = false
    const remaining = (reservations.get(userId) ?? 1) - 1
    if (remaining === 0) reservations.delete(userId)
    else reservations.set(userId, remaining)
  }
}

function kindCreationLimit(kind: RootResearchJobKind): number {
  switch (kind) {
    case "deep-search":
      return config.abuseProtection.maxDeepSearchCreationsPerWindow
    case "idea":
      return config.abuseProtection.maxIdeaJobCreationsPerWindow
    case "debate":
      return config.abuseProtection.maxDebateCreationsPerWindow
  }
}

function throwCreationRateLimit(oldestAdmission: Date, now: Date): never {
  const retryAfterSeconds = Math.max(
    1,
    Math.ceil(
      (oldestAdmission.getTime() +
        config.abuseProtection.researchJobCreationWindowMs -
        now.getTime()) /
        1_000,
    ),
  )
  const message =
    "Research job creation limit reached; try again after the current quota window"
  throw new HTTPException(429, {
    message,
    res: new Response(message, {
      headers: { "Retry-After": retryAfterSeconds.toString() },
    }),
  })
}

/**
 * Charges a durable rolling-window admission before provider work and reserves
 * one active root slot until the corresponding job row has been inserted.
 */
export function reserveRootResearchCapacity(
  userId: string,
  kind: RootResearchJobKind,
): () => void {
  const now = new Date()
  const cutoff = new Date(
    now.getTime() - config.abuseProtection.researchJobCreationWindowMs,
  )

  db.transaction((transaction) => {
    const activeDebates =
      transaction
        .select({ value: count() })
        .from(debateJobs)
        .where(
          and(eq(debateJobs.userId, userId), eq(debateJobs.status, "running")),
        )
        .get()?.value ?? 0
    const activeStandaloneIdeaJobs =
      transaction
        .select({ value: count() })
        .from(ideaJobs)
        .where(
          and(
            eq(ideaJobs.userId, userId),
            eq(ideaJobs.status, "running"),
            isNull(ideaJobs.debateJobId),
          ),
        )
        .get()?.value ?? 0
    const activeStandaloneSearches =
      transaction
        .select({ value: count() })
        .from(deepSearchJobs)
        .where(
          and(
            eq(deepSearchJobs.userId, userId),
            eq(deepSearchJobs.status, "running"),
            isNull(deepSearchJobs.ideaJobId),
          ),
        )
        .get()?.value ?? 0

    if (
      activeDebates +
        activeStandaloneIdeaJobs +
        activeStandaloneSearches +
        (pendingRootJobsByUser.get(userId) ?? 0) >=
      config.deepSearch.maxActiveRootJobsPerUser
    ) {
      throw new HTTPException(429, {
        message:
          "Too many active research jobs; wait for one to finish before starting another",
      })
    }

    const recentAdmissions = transaction
      .select({
        kind: researchJobAdmissions.kind,
        createdAt: researchJobAdmissions.createdAt,
      })
      .from(researchJobAdmissions)
      .where(
        and(
          eq(researchJobAdmissions.userId, userId),
          gte(researchJobAdmissions.createdAt, cutoff),
        ),
      )
      .orderBy(researchJobAdmissions.createdAt)
      .all()
    if (
      recentAdmissions.length >=
      config.abuseProtection.maxRootJobCreationsPerWindow
    ) {
      const oldestAdmission = recentAdmissions[0]
      if (!oldestAdmission) throw new Error("Missing root admission timestamp")
      throwCreationRateLimit(oldestAdmission.createdAt, now)
    }

    const sameKindAdmissions = recentAdmissions.filter(
      (admission) => admission.kind === kind,
    )
    if (sameKindAdmissions.length >= kindCreationLimit(kind)) {
      const oldestAdmission = sameKindAdmissions[0]
      if (!oldestAdmission) throw new Error("Missing admission timestamp")
      throwCreationRateLimit(oldestAdmission.createdAt, now)
    }

    transaction
      .insert(researchJobAdmissions)
      .values({
        researchJobAdmissionId: randomUUID(),
        userId,
        kind,
        createdAt: now,
      })
      .run()
  })

  return incrementReservation(pendingRootJobsByUser, userId)
}

/** Reserves capacity until a standalone generation row has been registered. */
export function reserveStandaloneGenerationCapacity(
  userId: string,
): () => void {
  const activeGenerations =
    db
      .select({ value: count() })
      .from(llmGenerations)
      .where(
        and(
          eq(llmGenerations.userId, userId),
          eq(llmGenerations.status, "running"),
          isNull(llmGenerations.debateJobId),
          isNull(llmGenerations.ideaJobId),
          isNull(llmGenerations.deepSearchJobId),
        ),
      )
      .get()?.value ?? 0

  if (
    activeGenerations +
      (pendingStandaloneGenerationsByUser.get(userId) ?? 0) >=
    config.llmExecution.maxActiveStandaloneGenerationsPerUser
  ) {
    throw new HTTPException(429, {
      message:
        "Too many active standalone generations; wait for one to finish before starting another",
    })
  }
  return incrementReservation(pendingStandaloneGenerationsByUser, userId)
}
