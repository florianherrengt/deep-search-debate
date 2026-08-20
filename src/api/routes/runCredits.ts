import { sql, type SQL } from "drizzle-orm"

import { db } from "../db/index.ts"
import {
  deepSearchJobs,
  deepSearchQueries,
  deepSearchRounds,
  deepSearchWebPages,
  ideaJobs,
  llmGenerations,
} from "../db/schema/index.ts"

function readCreditsUsed(query: SQL): number {
  const row = db.get<{ creditsUsed: number }>(query)
  const creditsUsed = row?.creditsUsed ?? 0
  if (!Number.isSafeInteger(creditsUsed) || creditsUsed < 0) {
    throw new Error("Persisted run credits must total a nonnegative integer")
  }
  return creditsUsed
}

/** Sums only settled costs directly owned by one deep-search run. */
export function getDeepSearchCreditsUsed(deepSearchJobId: string): number {
  return readCreditsUsed(sql`
    select coalesce(sum(credits_used), 0) as creditsUsed
    from (
      select ${llmGenerations.creditsUsed} as credits_used
      from ${llmGenerations}
      where ${llmGenerations.deepSearchJobId} = ${deepSearchJobId}

      union all

      select ${deepSearchQueries.creditsUsed} as credits_used
      from ${deepSearchQueries}
      inner join ${deepSearchRounds}
        on ${deepSearchRounds.deepSearchRoundId} = ${deepSearchQueries.deepSearchRoundId}
      where ${deepSearchRounds.deepSearchJobId} = ${deepSearchJobId}

      union all

      select ${deepSearchWebPages.creditsUsed} as credits_used
      from ${deepSearchWebPages}
      where ${deepSearchWebPages.deepSearchJobId} = ${deepSearchJobId}
    )
  `)
}

/** Sums an idea run's direct LLM costs and every owned deep-search leaf. */
export function getIdeaCreditsUsed(ideaJobId: string): number {
  return readCreditsUsed(sql`
    select coalesce(sum(credits_used), 0) as creditsUsed
    from (
      select ${llmGenerations.creditsUsed} as credits_used
      from ${llmGenerations}
      where ${llmGenerations.ideaJobId} = ${ideaJobId}

      union all

      select ${llmGenerations.creditsUsed} as credits_used
      from ${llmGenerations}
      inner join ${deepSearchJobs}
        on ${deepSearchJobs.deepSearchJobId} = ${llmGenerations.deepSearchJobId}
      where ${deepSearchJobs.ideaJobId} = ${ideaJobId}

      union all

      select ${deepSearchQueries.creditsUsed} as credits_used
      from ${deepSearchQueries}
      inner join ${deepSearchRounds}
        on ${deepSearchRounds.deepSearchRoundId} = ${deepSearchQueries.deepSearchRoundId}
      inner join ${deepSearchJobs}
        on ${deepSearchJobs.deepSearchJobId} = ${deepSearchRounds.deepSearchJobId}
      where ${deepSearchJobs.ideaJobId} = ${ideaJobId}

      union all

      select ${deepSearchWebPages.creditsUsed} as credits_used
      from ${deepSearchWebPages}
      inner join ${deepSearchJobs}
        on ${deepSearchJobs.deepSearchJobId} = ${deepSearchWebPages.deepSearchJobId}
      where ${deepSearchJobs.ideaJobId} = ${ideaJobId}
    )
  `)
}

/** Sums tournament LLM costs plus the debate-owned idea and search subtree. */
export function getDebateCreditsUsed(debateJobId: string): number {
  return readCreditsUsed(sql`
    select coalesce(sum(credits_used), 0) as creditsUsed
    from (
      select ${llmGenerations.creditsUsed} as credits_used
      from ${llmGenerations}
      where ${llmGenerations.debateJobId} = ${debateJobId}

      union all

      select ${llmGenerations.creditsUsed} as credits_used
      from ${llmGenerations}
      inner join ${ideaJobs}
        on ${ideaJobs.ideaJobId} = ${llmGenerations.ideaJobId}
      where ${ideaJobs.debateJobId} = ${debateJobId}

      union all

      select ${llmGenerations.creditsUsed} as credits_used
      from ${llmGenerations}
      inner join ${deepSearchJobs}
        on ${deepSearchJobs.deepSearchJobId} = ${llmGenerations.deepSearchJobId}
      inner join ${ideaJobs}
        on ${ideaJobs.ideaJobId} = ${deepSearchJobs.ideaJobId}
      where ${ideaJobs.debateJobId} = ${debateJobId}

      union all

      select ${deepSearchQueries.creditsUsed} as credits_used
      from ${deepSearchQueries}
      inner join ${deepSearchRounds}
        on ${deepSearchRounds.deepSearchRoundId} = ${deepSearchQueries.deepSearchRoundId}
      inner join ${deepSearchJobs}
        on ${deepSearchJobs.deepSearchJobId} = ${deepSearchRounds.deepSearchJobId}
      inner join ${ideaJobs}
        on ${ideaJobs.ideaJobId} = ${deepSearchJobs.ideaJobId}
      where ${ideaJobs.debateJobId} = ${debateJobId}

      union all

      select ${deepSearchWebPages.creditsUsed} as credits_used
      from ${deepSearchWebPages}
      inner join ${deepSearchJobs}
        on ${deepSearchJobs.deepSearchJobId} = ${deepSearchWebPages.deepSearchJobId}
      inner join ${ideaJobs}
        on ${ideaJobs.ideaJobId} = ${deepSearchJobs.ideaJobId}
      where ${ideaJobs.debateJobId} = ${debateJobId}
    )
  `)
}
