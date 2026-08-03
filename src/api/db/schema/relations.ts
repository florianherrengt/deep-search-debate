import { relations } from "drizzle-orm"

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
  }),
)
