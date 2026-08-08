import { and, eq, exists, or, sql, type SQL } from "drizzle-orm"

import { db } from "../db/index.ts"
import {
  debateJobs,
  deepSearchJobs,
  ideaJobs,
  llmGenerations,
} from "../db/schema/index.ts"

/** Limits debate-job rows to resources readable by the current viewer. */
export function debateJobReadScope(viewerUserId: string | null): SQL {
  const publicDebate = eq(debateJobs.isPublic, true)
  return viewerUserId === null
    ? publicDebate
    : or(eq(debateJobs.userId, viewerUserId), publicDebate)!
}

function ideaJobHasPublicDebate(): SQL {
  return exists(
    db
      .select({ one: sql<number>`1` })
      .from(debateJobs)
      .where(
        and(
          eq(debateJobs.debateJobId, ideaJobs.debateJobId),
          eq(debateJobs.isPublic, true),
        ),
      ),
  )
}

/** Limits idea-job rows to owned jobs or descendants of public debates. */
export function ideaJobReadScope(viewerUserId: string | null): SQL {
  const publicDebate = ideaJobHasPublicDebate()
  return viewerUserId === null
    ? publicDebate
    : or(eq(ideaJobs.userId, viewerUserId), publicDebate)!
}

function deepSearchJobHasPublicDebate(): SQL {
  return exists(
    db
      .select({ one: sql<number>`1` })
      .from(ideaJobs)
      .innerJoin(
        debateJobs,
        eq(debateJobs.debateJobId, ideaJobs.debateJobId),
      )
      .where(
        and(
          eq(ideaJobs.ideaJobId, deepSearchJobs.ideaJobId),
          eq(debateJobs.isPublic, true),
        ),
      ),
  )
}

/** Limits deep-search rows to owned jobs or descendants of public debates. */
export function deepSearchJobReadScope(viewerUserId: string | null): SQL {
  const publicDebate = deepSearchJobHasPublicDebate()
  return viewerUserId === null
    ? publicDebate
    : or(eq(deepSearchJobs.userId, viewerUserId), publicDebate)!
}

function generationHasPublicDebate(): SQL {
  const directDebate = exists(
    db
      .select({ one: sql<number>`1` })
      .from(debateJobs)
      .where(
        and(
          eq(debateJobs.debateJobId, llmGenerations.debateJobId),
          eq(debateJobs.isPublic, true),
        ),
      ),
  )
  const ideaDebate = exists(
    db
      .select({ one: sql<number>`1` })
      .from(ideaJobs)
      .innerJoin(
        debateJobs,
        eq(debateJobs.debateJobId, ideaJobs.debateJobId),
      )
      .where(
        and(
          eq(ideaJobs.ideaJobId, llmGenerations.ideaJobId),
          eq(debateJobs.isPublic, true),
        ),
      ),
  )
  const deepSearchDebate = exists(
    db
      .select({ one: sql<number>`1` })
      .from(deepSearchJobs)
      .innerJoin(ideaJobs, eq(ideaJobs.ideaJobId, deepSearchJobs.ideaJobId))
      .innerJoin(
        debateJobs,
        eq(debateJobs.debateJobId, ideaJobs.debateJobId),
      )
      .where(
        and(
          eq(
            deepSearchJobs.deepSearchJobId,
            llmGenerations.deepSearchJobId,
          ),
          eq(debateJobs.isPublic, true),
        ),
      ),
  )

  return or(directDebate, ideaDebate, deepSearchDebate)!
}

/** Limits generations to owned rows or any supported public-debate path. */
export function llmGenerationReadScope(viewerUserId: string | null): SQL {
  const publicDebate = generationHasPublicDebate()
  return viewerUserId === null
    ? publicDebate
    : or(eq(llmGenerations.userId, viewerUserId), publicDebate)!
}
