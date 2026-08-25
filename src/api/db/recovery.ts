import { and, asc, isNull, ne } from "drizzle-orm"

import type { DebateJobManager } from "../routes/debates/manager.ts"
import type { DeepSearchJobManager } from "../routes/deepSearch/manager.ts"
import type { IdeaJobManager } from "../routes/ideas/manager.ts"
import { db } from "./index.ts"
import { debateJobs, deepSearchJobs, ideaJobs } from "./schema/index.ts"

type ResearchManagers = {
  debates: Pick<DebateJobManager, "resumeExisting">
  ideas: Pick<IdeaJobManager, "resumeExisting">
  deepSearches: Pick<DeepSearchJobManager, "resumeExisting">
}

export type PersistedResearchRoots = {
  debateJobIds: string[]
  ideaJobIds: string[]
  deepSearchJobIds: string[]
}

/** Finds only effective roots. Descendants are resumed by their owning parent. */
export function loadPersistedResearchRoots(): PersistedResearchRoots {
  const debateJobIds = db
    .select({ id: debateJobs.debateJobId })
    .from(debateJobs)
    .where(ne(debateJobs.status, "completed"))
    .orderBy(asc(debateJobs.createdAt), asc(debateJobs.debateJobId))
    .all()
    .map(({ id }) => id)
  const ideaJobIds = db
    .select({ id: ideaJobs.ideaJobId })
    .from(ideaJobs)
    .where(
      and(isNull(ideaJobs.debateJobId), ne(ideaJobs.status, "completed")),
    )
    .orderBy(asc(ideaJobs.createdAt), asc(ideaJobs.ideaJobId))
    .all()
    .map(({ id }) => id)
  const deepSearchJobIds = db
    .select({ id: deepSearchJobs.deepSearchJobId })
    .from(deepSearchJobs)
    .where(
      and(
        isNull(deepSearchJobs.ideaJobId),
        ne(deepSearchJobs.status, "completed"),
      ),
    )
    .orderBy(
      asc(deepSearchJobs.createdAt),
      asc(deepSearchJobs.deepSearchJobId),
    )
    .all()
    .map(({ id }) => id)

  return { debateJobIds, ideaJobIds, deepSearchJobIds }
}

/**
 * Schedules every persisted effective root before the HTTP server starts.
 * A synchronous reset/scheduling failure is intentionally allowed to fail
 * startup. Failures after scheduling are retained on the root by its manager.
 */
export function reconcilePersistedResearchRoots(
  managers: ResearchManagers,
): PersistedResearchRoots {
  const roots = loadPersistedResearchRoots()
  for (const debateJobId of roots.debateJobIds) {
    void managers.debates.resumeExisting(debateJobId).completion.catch(() => {})
  }
  for (const ideaJobId of roots.ideaJobIds) {
    void managers.ideas.resumeExisting(ideaJobId).completion.catch(() => {})
  }
  for (const deepSearchJobId of roots.deepSearchJobIds) {
    void managers.deepSearches
      .resumeExisting(deepSearchJobId)
      .completion.catch(() => {})
  }
  return roots
}
