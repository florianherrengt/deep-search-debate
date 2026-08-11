import { and, count, eq, isNull } from "drizzle-orm"
import { HTTPException } from "hono/http-exception"
import { config } from "../config.ts"
import { db } from "../db/index.ts"
import {
  debateJobs,
  deepSearchJobs,
  ideaJobs,
  llmGenerations,
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

/** Prevents one user from filling the process queue with root workflows. */
export function reserveRootResearchCapacity(userId: string): () => void {
  const activeDebates =
    db
      .select({ value: count() })
      .from(debateJobs)
      .where(
        and(eq(debateJobs.userId, userId), eq(debateJobs.status, "running")),
      )
      .get()?.value ?? 0
  const activeStandaloneIdeaJobs =
    db
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
    db
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
