import { relations } from "drizzle-orm"

import {
  debateJobs,
  debateMatches,
  debateMessages,
  debateRounds,
} from "./debateJobs.ts"
import { deepSearchJobs } from "./deepSearchJobs.ts"
import {
  deepSearchGeneratedQueries,
  deepSearchQueries,
  deepSearchQueryGenerations,
} from "./deepSearchQueries.ts"
import {
  deepSearchResults,
  deepSearchWebPages,
} from "./deepSearchResults.ts"
import { ideaJobs } from "./ideaJobs.ts"
import { ideas } from "./ideas.ts"
import { llmGenerations } from "./llmGenerations.ts"

export const deepSearchJobsRelations = relations(
  deepSearchJobs,
  ({ many, one }) => ({
    queryGeneration: one(deepSearchQueryGenerations),
    finalAnswerGeneration: one(llmGenerations, {
      fields: [deepSearchJobs.finalAnswerGenerationId],
      references: [llmGenerations.llmGenerationId],
    }),
    webPages: many(deepSearchWebPages),
    ideaJob: one(ideaJobs, {
      fields: [deepSearchJobs.ideaJobId],
      references: [ideaJobs.ideaJobId],
    }),
  }),
)

export const deepSearchQueryGenerationsRelations = relations(
  deepSearchQueryGenerations,
  ({ many, one }) => ({
    job: one(deepSearchJobs, {
      fields: [deepSearchQueryGenerations.deepSearchJobId],
      references: [deepSearchJobs.deepSearchJobId],
    }),
    llmGeneration: one(llmGenerations, {
      fields: [deepSearchQueryGenerations.llmGenerationId],
      references: [llmGenerations.llmGenerationId],
    }),
    generatedQueries: many(deepSearchGeneratedQueries),
  }),
)

export const deepSearchGeneratedQueriesRelations = relations(
  deepSearchGeneratedQueries,
  ({ one }) => ({
    queryGeneration: one(deepSearchQueryGenerations, {
      fields: [deepSearchGeneratedQueries.deepSearchQueryGenerationId],
      references: [
        deepSearchQueryGenerations.deepSearchQueryGenerationId,
      ],
    }),
    execution: one(deepSearchQueries),
  }),
)

export const deepSearchQueriesRelations = relations(
  deepSearchQueries,
  ({ many, one }) => ({
    generatedQuery: one(deepSearchGeneratedQueries, {
      fields: [deepSearchQueries.deepSearchGeneratedQueryId],
      references: [deepSearchGeneratedQueries.deepSearchGeneratedQueryId],
    }),
    selectionGeneration: one(llmGenerations, {
      fields: [deepSearchQueries.selectionGenerationId],
      references: [llmGenerations.llmGenerationId],
      relationName: "deepSearchQuerySelectionGeneration",
    }),
    summaryGeneration: one(llmGenerations, {
      fields: [deepSearchQueries.summaryGenerationId],
      references: [llmGenerations.llmGenerationId],
      relationName: "deepSearchQuerySummaryGeneration",
    }),
    results: many(deepSearchResults),
  }),
)

export const deepSearchWebPagesRelations = relations(
  deepSearchWebPages,
  ({ many, one }) => ({
    job: one(deepSearchJobs, {
      fields: [deepSearchWebPages.deepSearchJobId],
      references: [deepSearchJobs.deepSearchJobId],
    }),
    summaryGeneration: one(llmGenerations, {
      fields: [deepSearchWebPages.summaryGenerationId],
      references: [llmGenerations.llmGenerationId],
    }),
    results: many(deepSearchResults),
  }),
)

export const deepSearchResultsRelations = relations(
  deepSearchResults,
  ({ one }) => ({
    query: one(deepSearchQueries, {
      fields: [deepSearchResults.deepSearchQueryId],
      references: [deepSearchQueries.deepSearchQueryId],
    }),
    webPage: one(deepSearchWebPages, {
      fields: [deepSearchResults.deepSearchWebPageId],
      references: [deepSearchWebPages.deepSearchWebPageId],
    }),
  }),
)

export const ideaJobsRelations = relations(
  ideaJobs,
  ({ many, one }) => ({
    researchPromptGeneration: one(llmGenerations, {
      fields: [ideaJobs.researchPromptGenerationId],
      references: [llmGenerations.llmGenerationId],
      relationName: "ideaJobResearchPromptGeneration",
    }),
    researchSummaryGeneration: one(llmGenerations, {
      fields: [ideaJobs.researchSummaryGenerationId],
      references: [llmGenerations.llmGenerationId],
      relationName: "ideaJobResearchSummaryGeneration",
    }),
    ideaGeneration: one(llmGenerations, {
      fields: [ideaJobs.ideaGenerationId],
      references: [llmGenerations.llmGenerationId],
      relationName: "ideaJobIdeaGeneration",
    }),
    deepSearchJobs: many(deepSearchJobs),
    ideas: many(ideas),
    debateJob: one(debateJobs),
  }),
)

export const ideasRelations = relations(ideas, ({ many, one }) => ({
  job: one(ideaJobs, {
    fields: [ideas.ideaJobId],
    references: [ideaJobs.ideaJobId],
  }),
  matchesAsFirst: many(debateMatches, {
    relationName: "debateMatchFirstIdea",
  }),
  matchesAsSecond: many(debateMatches, {
    relationName: "debateMatchSecondIdea",
  }),
  matchWins: many(debateMatches, {
    relationName: "debateMatchWinnerIdea",
  }),
}))

export const debateJobsRelations = relations(
  debateJobs,
  ({ many, one }) => ({
    ideaJob: one(ideaJobs, {
      fields: [debateJobs.ideaJobId],
      references: [ideaJobs.ideaJobId],
    }),
    rounds: many(debateRounds),
  }),
)

export const debateRoundsRelations = relations(
  debateRounds,
  ({ many, one }) => ({
    job: one(debateJobs, {
      fields: [debateRounds.debateJobId],
      references: [debateJobs.debateJobId],
    }),
    matches: many(debateMatches),
  }),
)

export const debateMatchesRelations = relations(
  debateMatches,
  ({ many, one }) => ({
    round: one(debateRounds, {
      fields: [debateMatches.debateRoundId],
      references: [debateRounds.debateRoundId],
    }),
    firstIdea: one(ideas, {
      fields: [debateMatches.firstIdeaId],
      references: [ideas.ideaId],
      relationName: "debateMatchFirstIdea",
    }),
    secondIdea: one(ideas, {
      fields: [debateMatches.secondIdeaId],
      references: [ideas.ideaId],
      relationName: "debateMatchSecondIdea",
    }),
    winnerIdea: one(ideas, {
      fields: [debateMatches.winnerIdeaId],
      references: [ideas.ideaId],
      relationName: "debateMatchWinnerIdea",
    }),
    messages: many(debateMessages),
  }),
)

export const debateMessagesRelations = relations(
  debateMessages,
  ({ one }) => ({
    match: one(debateMatches, {
      fields: [debateMessages.debateMatchId],
      references: [debateMatches.debateMatchId],
    }),
    llmGeneration: one(llmGenerations, {
      fields: [debateMessages.llmGenerationId],
      references: [llmGenerations.llmGenerationId],
    }),
  }),
)
