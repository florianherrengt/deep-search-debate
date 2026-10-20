import { and, count, eq, isNotNull, isNull } from "drizzle-orm"

import { db } from "../../db/index.ts"
import {
  deepSearchJobs,
  deepSearchWebPages,
  ideaJobs,
} from "../../db/schema/index.ts"
import {
  assertEffectiveResearchRootRunning,
  EffectiveResearchRootInactiveError,
  resolveEffectiveResearchRoot,
  type EffectiveResearchRoot,
  type ResearchTransaction,
} from "../researchCancellation.ts"

type CaptchaReservationErrorCode =
  | "page-not-owned"
  | "root-inactive"
  | "budget-exhausted"
  | "invalid-budget"
  | "invalid-task-id"
  | "attempt-not-reserved"
  | "task-id-conflict"

const captchaReservationErrorMessages: Record<CaptchaReservationErrorCode, string> = {
  "page-not-owned": "Deep-search page was not found or is not owned by this user",
  "root-inactive": "CAPTCHA attempts cannot be reserved for a stopped or inactive research job",
  "budget-exhausted": "The CAPTCHA task budget for this research job has been reached",
  "invalid-budget": "The CAPTCHA task budget must be between 1 and 10",
  "invalid-task-id": "The CAPTCHA task ID must contain 1 to 200 characters",
  "attempt-not-reserved": "A CAPTCHA task cannot be registered without a reserved attempt",
  "task-id-conflict": "A different CAPTCHA task is already registered for this page",
}

/** Fixed, safe failures for browser orchestration to handle without leaking row details. */
class CaptchaReservationError extends Error {
  readonly code: CaptchaReservationErrorCode

  constructor(code: CaptchaReservationErrorCode) {
    super(captchaReservationErrorMessages[code])
    this.name = "CaptchaReservationError"
    this.code = code
  }
}

export type ReserveCaptchaAttemptInput = {
  userId: string
  deepSearchJobId: string
  pageId: string
  maxTasksPerRootJob: number
}

export type ReservedCaptchaAttempt = {
  created: boolean
  taskId: string | null
}

export type RegisterCaptchaTaskInput = {
  userId: string
  deepSearchJobId: string
  pageId: string
  taskId: string
}

function getOwnedPage(
  transaction: ResearchTransaction,
  { userId, deepSearchJobId, pageId }: Pick<
    ReserveCaptchaAttemptInput,
    "userId" | "deepSearchJobId" | "pageId"
  >,
) {
  const page = transaction
    .select({
      captchaTaskId: deepSearchWebPages.captchaTaskId,
    })
    .from(deepSearchWebPages)
    .innerJoin(
      deepSearchJobs,
      eq(deepSearchWebPages.deepSearchJobId, deepSearchJobs.deepSearchJobId),
    )
    .where(
      and(
        eq(deepSearchWebPages.deepSearchWebPageId, pageId),
        eq(deepSearchWebPages.deepSearchJobId, deepSearchJobId),
        eq(deepSearchJobs.userId, userId),
      ),
    )
    .get()
  if (!page) throw new CaptchaReservationError("page-not-owned")
  return page
}

function getOwnedEffectiveRoot(
  transaction: ResearchTransaction,
  userId: string,
  deepSearchJobId: string,
): EffectiveResearchRoot {
  const root = resolveEffectiveResearchRoot(transaction, {
    kind: "deep-search",
    jobId: deepSearchJobId,
  })
  if (!root || root.userId !== userId) {
    throw new CaptchaReservationError("page-not-owned")
  }
  try {
    return assertEffectiveResearchRootRunning(transaction, {
      kind: "deep-search",
      jobId: deepSearchJobId,
    })
  } catch (error) {
    if (error instanceof EffectiveResearchRootInactiveError) {
      throw new CaptchaReservationError("root-inactive")
    }
    throw error
  }
}

function countRootReservations(
  transaction: ResearchTransaction,
  root: EffectiveResearchRoot,
): number {
  const countWith = (condition: ReturnType<typeof eq>): number => transaction
    .select({ count: count() })
    .from(deepSearchWebPages)
    .innerJoin(
      deepSearchJobs,
      eq(deepSearchWebPages.deepSearchJobId, deepSearchJobs.deepSearchJobId),
    )
    .where(and(isNotNull(deepSearchWebPages.captchaTaskId), condition))
    .get()?.count ?? 0

  if (root.kind === "deep-search") {
    return countWith(eq(deepSearchJobs.deepSearchJobId, root.jobId))
  }
  if (root.kind === "idea") {
    return countWith(eq(deepSearchJobs.ideaJobId, root.jobId))
  }
  return transaction
    .select({ count: count() })
    .from(deepSearchWebPages)
    .innerJoin(
      deepSearchJobs,
      eq(deepSearchWebPages.deepSearchJobId, deepSearchJobs.deepSearchJobId),
    )
    .innerJoin(ideaJobs, eq(deepSearchJobs.ideaJobId, ideaJobs.ideaJobId))
    .where(
      and(
        isNotNull(deepSearchWebPages.captchaTaskId),
        eq(ideaJobs.debateJobId, root.jobId),
      ),
    )
    .get()?.count ?? 0
}

/** Reserve one irreversible CapSolver attempt for an owned page. */
export function reserveCaptchaAttempt({
  userId,
  deepSearchJobId,
  pageId,
  maxTasksPerRootJob,
}: ReserveCaptchaAttemptInput): ReservedCaptchaAttempt {
  if (!Number.isSafeInteger(maxTasksPerRootJob) || maxTasksPerRootJob < 1 || maxTasksPerRootJob > 10) {
    throw new CaptchaReservationError("invalid-budget")
  }

  return db.transaction((transaction) => {
    const page = getOwnedPage(transaction, { userId, deepSearchJobId, pageId })
    const root = getOwnedEffectiveRoot(transaction, userId, deepSearchJobId)
    if (page.captchaTaskId !== null) return {
      created: false,
      taskId: page.captchaTaskId || null,
    }
    if (countRootReservations(transaction, root) >= maxTasksPerRootJob) {
      throw new CaptchaReservationError("budget-exhausted")
    }

    transaction
      .update(deepSearchWebPages)
      .set({ captchaTaskId: "" })
      .where(
        and(
          eq(deepSearchWebPages.deepSearchWebPageId, pageId),
          isNull(deepSearchWebPages.captchaTaskId),
        ),
      )
      .run()
    return { created: true, taskId: null }
  }, { behavior: "immediate" })
}

function validateTaskId(taskId: string): string {
  const normalized = taskId.trim()
  if (normalized.length === 0 || normalized.length > 200) {
    throw new CaptchaReservationError("invalid-task-id")
  }
  return normalized
}

/** Record a paid task ID even if Stop raced CapSolver's createTask response. */
export function registerCaptchaTask({
  userId,
  deepSearchJobId,
  pageId,
  taskId,
}: RegisterCaptchaTaskInput): void {
  const normalizedTaskId = validateTaskId(taskId)
  db.transaction((transaction) => {
    const page = getOwnedPage(transaction, { userId, deepSearchJobId, pageId })
    if (page.captchaTaskId === null) {
      throw new CaptchaReservationError("attempt-not-reserved")
    }
    if (page.captchaTaskId !== "") {
      if (page.captchaTaskId === normalizedTaskId) return
      throw new CaptchaReservationError("task-id-conflict")
    }
    transaction
      .update(deepSearchWebPages)
      .set({ captchaTaskId: normalizedTaskId })
      .where(and(
        eq(deepSearchWebPages.deepSearchWebPageId, pageId),
        eq(deepSearchWebPages.captchaTaskId, ""),
      ))
      .run()
  }, { behavior: "immediate" })
}
