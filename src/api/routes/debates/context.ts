import { asc, eq } from "drizzle-orm"

import { db } from "../../db/index.ts"
import {
  deepSearchJobs,
  ideaJobs,
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
    .where(eq(deepSearchJobs.ideaJobId, ideaJobId))
    .orderBy(asc(deepSearchJobs.createdAt))
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

function serialize(value: unknown): string {
  return JSON.stringify(value, null, 2)
}

export function buildOpeningPrompt(
  context: DebateContext,
  candidate: DebateCandidate,
  opponent: DebateCandidate,
): string {
  return [
    "<debate_context>",
    serialize(context),
    "</debate_context>",
    "<assigned_candidate>",
    serialize(candidate),
    "</assigned_candidate>",
    "<opponent_candidate>",
    serialize(opponent),
    "</opponent_candidate>",
  ].join("\n")
}

export function buildRebuttalPrompt(
  context: DebateContext,
  candidate: DebateCandidate,
  opponent: DebateCandidate,
  candidateOpening: string,
  opponentOpening: string,
): string {
  return [
    buildOpeningPrompt(context, candidate, opponent),
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
  transcript: string[],
): string {
  return [
    "<debate_context>",
    serialize(context),
    "</debate_context>",
    "<candidate_a>",
    serialize(firstCandidate),
    "</candidate_a>",
    "<candidate_b>",
    serialize(secondCandidate),
    "</candidate_b>",
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
