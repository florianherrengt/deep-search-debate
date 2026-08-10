import { and, asc, eq, lt } from "drizzle-orm"

import { db } from "../../db/index.ts"
import {
  deepSearchJobs,
  ideaJobs,
  ideas,
  llmGenerations,
} from "../../db/schema/index.ts"

export type DebateContext = {
  userRequest: string
  researchBriefing: string
  deepSearchResults: Array<{
    researchRequest: string
    answer: string
  }>
}

export type DebateCandidate = {
  ideaId: string
  title: string
  description: string
}

export type DebateCandidateResearch = {
  researchRequest: string
  answer: string
}

export function loadDebateContext(ideaJobId: string): DebateContext {
  const job = db
    .select()
    .from(ideaJobs)
    .where(eq(ideaJobs.ideaJobId, ideaJobId))
    .get()
  if (!job) throw new Error("Idea job was not found")
  if (!job.researchSummaryGenerationId) {
    throw new Error("Idea research briefing was not generated")
  }

  const briefing = db
    .select({ text: llmGenerations.text, status: llmGenerations.status })
    .from(llmGenerations)
    .where(
      eq(
        llmGenerations.llmGenerationId,
        job.researchSummaryGenerationId,
      ),
    )
    .get()
  if (briefing?.status !== "completed" || briefing.text === null) {
    throw new Error("Idea research briefing did not complete")
  }

  const results = db
    .select({
      researchRequest: deepSearchJobs.researchRequest,
      answer: llmGenerations.text,
      status: llmGenerations.status,
    })
    .from(deepSearchJobs)
    .innerJoin(
      llmGenerations,
      eq(
        deepSearchJobs.finalAnswerGenerationId,
        llmGenerations.llmGenerationId,
      ),
    )
    .where(
      and(
        eq(deepSearchJobs.ideaJobId, ideaJobId),
        lt(deepSearchJobs.ideaJobPosition, job.deepSearchCount),
      ),
    )
    .orderBy(asc(deepSearchJobs.ideaJobPosition))
    .all()

  if (
    results.length !== job.deepSearchCount ||
    results.some((result) => result.status !== "completed" || !result.answer)
  ) {
    throw new Error("Deep-search results did not complete")
  }

  return {
    userRequest: job.prompt,
    researchBriefing: briefing.text,
    deepSearchResults: results.map((result) => ({
      researchRequest: result.researchRequest,
      answer: result.answer!,
    })),
  }
}

export function loadDebateCandidateResearch(
  ideaJobId: string,
): Map<string, DebateCandidateResearch> {
  const rows = db
    .select({
      ideaId: ideas.ideaId,
      researchRequest: deepSearchJobs.researchRequest,
      answer: llmGenerations.text,
      searchStatus: deepSearchJobs.status,
      generationStatus: llmGenerations.status,
    })
    .from(ideas)
    .innerJoin(
      deepSearchJobs,
      eq(ideas.deepSearchJobId, deepSearchJobs.deepSearchJobId),
    )
    .innerJoin(
      llmGenerations,
      eq(
        deepSearchJobs.finalAnswerGenerationId,
        llmGenerations.llmGenerationId,
      ),
    )
    .where(
      and(eq(ideas.ideaJobId, ideaJobId), eq(ideas.selected, true)),
    )
    .all()

  const research = new Map<string, DebateCandidateResearch>()
  for (const row of rows) {
    if (
      row.searchStatus !== "completed" ||
      row.generationStatus !== "completed" ||
      !row.answer?.trim()
    ) {
      throw new Error("Selected-idea research did not complete")
    }
    research.set(row.ideaId, {
      researchRequest: row.researchRequest,
      answer: row.answer,
    })
  }
  return research
}

function serialize(value: unknown): string {
  return JSON.stringify(value, null, 2)
}

export function buildOpeningPrompt(
  context: DebateContext,
  candidate: DebateCandidate,
  opponent: DebateCandidate,
  candidateResearch: DebateCandidateResearch,
): string {
  return [
    "<debate_context>",
    serialize(context),
    "</debate_context>",
    "<assigned_candidate>",
    serialize(candidate),
    "</assigned_candidate>",
    "<assigned_candidate_research>",
    serialize(candidateResearch),
    "</assigned_candidate_research>",
    "<opponent_candidate>",
    serialize(opponent),
    "</opponent_candidate>",
  ].join("\n")
}

export function buildRebuttalPrompt(
  context: DebateContext,
  candidate: DebateCandidate,
  opponent: DebateCandidate,
  candidateResearch: DebateCandidateResearch,
  candidateOpening: string,
  opponentOpening: string,
): string {
  return [
    buildOpeningPrompt(context, candidate, opponent, candidateResearch),
    "<assigned_candidate_opening>",
    candidateOpening,
    "</assigned_candidate_opening>",
    "<opponent_opening>",
    opponentOpening,
    "</opponent_opening>",
  ].join("\n")
}

export function buildJudgePrompt(
  context: DebateContext,
  firstCandidate: DebateCandidate,
  secondCandidate: DebateCandidate,
  firstCandidateResearch: DebateCandidateResearch,
  secondCandidateResearch: DebateCandidateResearch,
  transcript: string[],
): string {
  return [
    "<debate_context>",
    serialize(context),
    "</debate_context>",
    "<candidate_a>",
    serialize(firstCandidate),
    "</candidate_a>",
    "<candidate_a_research>",
    serialize(firstCandidateResearch),
    "</candidate_a_research>",
    "<candidate_b>",
    serialize(secondCandidate),
    "</candidate_b>",
    "<candidate_b_research>",
    serialize(secondCandidateResearch),
    "</candidate_b_research>",
    "<transcript>",
    serialize([
      { speaker: "Candidate A", message: transcript[0] },
      { speaker: "Candidate B", message: transcript[1] },
      { speaker: "Candidate A", message: transcript[2] },
      { speaker: "Candidate B", message: transcript[3] },
    ]),
    "</transcript>",
  ].join("\n")
}
