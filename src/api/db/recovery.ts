import {
  and,
  eq,
  inArray,
  isNotNull,
  isNull,
  sql,
  type SQLWrapper,
} from "drizzle-orm"

import { db } from "./index.ts"
import {
  debateJobs,
  debateMatches,
  debateRounds,
  deepSearchJobs,
  deepSearchQueries,
  deepSearchRounds,
  deepSearchWebPages,
  ideaJobs,
  llmGenerations,
} from "./schema/index.ts"

const interruptionMessage = "Interrupted by a server restart"
const stoppedMessage = "Stopped by user"
const parentStoppedMessage = "Interrupted because the parent workflow was stopped"

function hasStoppedIdea(ideaJobId: SQLWrapper) {
  return sql`exists (
    select 1
    from idea_jobs as cancellation_idea
    left join debate_jobs as cancellation_debate
      on cancellation_debate.debate_job_id = cancellation_idea.debate_job_id
    where cancellation_idea.idea_job_id = ${ideaJobId}
      and coalesce(
        cancellation_idea.cancel_requested_at,
        cancellation_debate.cancel_requested_at
      ) is not null
  )`
}

function hasStoppedDeepSearch(deepSearchJobId: SQLWrapper) {
  return sql`exists (
    select 1
    from deep_search_jobs as cancellation_deep_search
    left join idea_jobs as cancellation_idea
      on cancellation_idea.idea_job_id = cancellation_deep_search.idea_job_id
    left join debate_jobs as cancellation_debate
      on cancellation_debate.debate_job_id = cancellation_idea.debate_job_id
    where cancellation_deep_search.deep_search_job_id = ${deepSearchJobId}
      and coalesce(
        cancellation_deep_search.cancel_requested_at,
        cancellation_idea.cancel_requested_at,
        cancellation_debate.cancel_requested_at
      ) is not null
  )`
}

const stoppedGeneration = sql`(
  (${llmGenerations.debateJobId} is not null and exists (
    select 1
    from debate_jobs as cancellation_debate
    where cancellation_debate.debate_job_id = ${llmGenerations.debateJobId}
      and cancellation_debate.cancel_requested_at is not null
  ))
  or (${llmGenerations.ideaJobId} is not null and ${hasStoppedIdea(llmGenerations.ideaJobId)})
  or (${llmGenerations.deepSearchJobId} is not null and ${hasStoppedDeepSearch(llmGenerations.deepSearchJobId)})
)`

const stoppedQuery = hasStoppedDeepSearch(sql`(
  select cancellation_round.deep_search_job_id
  from deep_search_rounds as cancellation_round
  where cancellation_round.deep_search_round_id = ${deepSearchQueries.deepSearchRoundId}
)`)

function interruptionReason(stopped: SQLWrapper) {
  return sql`case
    when ${stopped} then ${parentStoppedMessage}
    else ${interruptionMessage}
  end`
}

/** Converts work that cannot survive a process restart into typed terminal rows. */
export function recoverInterruptedWork(): void {
  const completedAt = new Date()

  db.transaction((transaction) => {
    // Classify every orphan from the persisted root timestamp before ordinary
    // recovery. The timestamp remains on directly stopped roots, so descendants
    // can use the same classification throughout this transaction.
    transaction.update(llmGenerations)
      .set({
        status: "interrupted",
        error: interruptionReason(stoppedGeneration),
        completedAt,
      })
      .where(eq(llmGenerations.status, "running"))
      .run()

    transaction.update(deepSearchRounds)
      .set({
        reviewError: interruptionReason(
          hasStoppedDeepSearch(deepSearchRounds.deepSearchJobId),
        ),
        reviewCompletedAt: completedAt,
      })
      .where(
        and(
          isNotNull(deepSearchRounds.reviewGenerationId),
          isNull(deepSearchRounds.reviewCompletedAt),
        ),
      )
      .run()

    transaction.update(deepSearchQueries)
      .set({
        status: "failed",
        errorStage: sql`case ${deepSearchQueries.status}
          when 'searching' then 'search'
          when 'selecting' then 'selection'
          else 'summary'
        end`,
        errorMessage: interruptionReason(stoppedQuery),
        completedAt,
      })
      .where(
        inArray(deepSearchQueries.status, [
          "searching",
          "selecting",
          "summarizing",
        ]),
      )
      .run()

    transaction.update(deepSearchWebPages)
      .set({
        status: "failed",
        errorStage: sql`case
          when ${deepSearchWebPages.status} = 'summarizing' then 'summary'
          else 'extraction'
        end`,
        errorMessage: interruptionReason(
          hasStoppedDeepSearch(deepSearchWebPages.deepSearchJobId),
        ),
        completedAt,
      })
      .where(
        inArray(deepSearchWebPages.status, [
          "pending",
          "extracting",
          "summarizing",
        ]),
      )
      .run()

    transaction.update(deepSearchJobs)
      .set({
        status: "interrupted",
        error: sql`case
          when ${deepSearchJobs.cancelRequestedAt} is not null then ${stoppedMessage}
          else ${interruptionReason(
            hasStoppedDeepSearch(deepSearchJobs.deepSearchJobId),
          )}
        end`,
        completedAt,
      })
      .where(eq(deepSearchJobs.status, "running"))
      .run()

    transaction.update(ideaJobs)
      .set({
        status: "interrupted",
        error: sql`case
          when ${ideaJobs.cancelRequestedAt} is not null then ${stoppedMessage}
          else ${interruptionReason(hasStoppedIdea(ideaJobs.ideaJobId))}
        end`,
        completedAt,
      })
      .where(eq(ideaJobs.status, "running"))
      .run()

    // A persisted debate stop must win over final-verdict crash repair.
    transaction.update(debateJobs)
      .set({ status: "interrupted", error: stoppedMessage, completedAt })
      .where(
        and(
          eq(debateJobs.status, "running"),
          isNotNull(debateJobs.cancelRequestedAt),
        ),
      )
      .run()

    // The final verdict and machine-readable winner commit atomically, just
    // before the runner marks its parent job complete. Close that small crash
    // window by recognizing the one fully completed final match on restart.
    transaction.update(debateJobs)
      .set({ status: "completed", completedAt })
      .where(
        and(
          eq(debateJobs.status, "running"),
          sql`1 = (
            select count(*)
            from ${debateRounds}
            inner join ${debateMatches}
              on ${debateMatches.debateRoundId} = ${debateRounds.debateRoundId}
            where ${debateRounds.debateJobId} = ${debateJobs.debateJobId}
              and ${debateRounds.stage} = 'final'
              and ${debateRounds.stageRoundNumber} = 1
              and ${debateMatches.winnerIdeaId} is not null
              and ${debateMatches.completedAt} is not null
          )`,
        ),
      )
      .run()

    transaction.update(debateJobs)
      .set({
        status: "interrupted",
        error: interruptionMessage,
        completedAt,
      })
      .where(eq(debateJobs.status, "running"))
      .run()
  })
}
