import { and, eq } from "drizzle-orm"

import { db } from "../../db/index.ts"
import {
  debateJobs,
  deepSearchJobs,
  ideaJobs,
  llmGenerations,
} from "../../db/schema/index.ts"
import { WorkflowInterruptedError } from "../../workflowRuntime.ts"
import { interruptIdeaJob } from "../ideas/jobLifecycle.ts"
import { assertEffectiveResearchRootRunning } from "../researchCancellation.ts"
import type { DebateJobStage } from "./schemas.ts"

const stageOrder: Record<DebateJobStage, number> = {
  ideas: 0,
  swiss: 1,
  semifinal: 2,
  final: 3,
}

/** Reopens one parked root while retaining its exact linked stage attempts. */
export function reopenDebateJob(debateJobId: string): void {
  db.transaction((transaction) => {
    const job = transaction
      .select({ status: debateJobs.status })
      .from(debateJobs)
      .where(eq(debateJobs.debateJobId, debateJobId))
      .get()
    if (!job) throw new Error("Debate job was not found")
    if (job.status === "completed") {
      throw new Error("Completed debate jobs cannot be resumed")
    }

    const reopened = transaction
      .update(debateJobs)
      .set({
        status: "running",
        error: null,
        completedAt: null,
        cancelRequestedAt: null,
      })
      .where(eq(debateJobs.debateJobId, debateJobId))
      .run()
    if (reopened.changes !== 1) throw new Error("Debate job was not found")
  })
}

export function setDebateJobStage(
  debateJobId: string,
  stage: Exclude<DebateJobStage, "ideas">,
): void {
  const expectedStage: DebateJobStage =
    stage === "swiss" ? "ideas" : stage === "semifinal" ? "swiss" : "semifinal"
  db.transaction((transaction) => {
    assertEffectiveResearchRootRunning(transaction, {
      kind: "debate",
      jobId: debateJobId,
    })
    const current = transaction
      .select({ stage: debateJobs.stage })
      .from(debateJobs)
      .where(eq(debateJobs.debateJobId, debateJobId))
      .get()
    if (!current) throw new Error("Running debate job was not found")
    if (stageOrder[current.stage] >= stageOrder[stage]) return
    const result = transaction
      .update(debateJobs)
      .set({ stage })
      .where(
        and(
          eq(debateJobs.debateJobId, debateJobId),
          eq(debateJobs.status, "running"),
          eq(debateJobs.stage, expectedStage),
        ),
      )
      .run()
    if (result.changes !== 1) throw new Error("Running debate job was not found")
  })
}

export function completeDebateJob(debateJobId: string): void {
  db.transaction((transaction) => {
    assertEffectiveResearchRootRunning(transaction, {
      kind: "debate",
      jobId: debateJobId,
    })
    const activeGeneration = transaction
      .select({ id: llmGenerations.llmGenerationId })
      .from(llmGenerations)
      .where(
        and(
          eq(llmGenerations.debateJobId, debateJobId),
          eq(llmGenerations.status, "running"),
        ),
      )
      .get()
    if (activeGeneration) {
      throw new Error("Debate generations must settle before parent completion")
    }
    const winnerWebsite = transaction
      .select({ status: llmGenerations.status })
      .from(debateJobs)
      .innerJoin(
        llmGenerations,
        eq(
          llmGenerations.llmGenerationId,
          debateJobs.websiteGenerationId,
        ),
      )
      .where(eq(debateJobs.debateJobId, debateJobId))
      .get()
    if (!winnerWebsite || winnerWebsite.status !== "completed") {
      throw new Error(
        "The winning idea website must complete before the debate",
      )
    }
    const unfinishedIdea = transaction
      .select({ id: ideaJobs.ideaJobId })
      .from(ideaJobs)
      .where(
        and(
          eq(ideaJobs.debateJobId, debateJobId),
          eq(ideaJobs.status, "running"),
        ),
      )
      .get()
    if (unfinishedIdea) {
      throw new Error("Debate idea research must settle before completion")
    }
    const unfinishedSearch = transaction
      .select({ id: deepSearchJobs.deepSearchJobId })
      .from(deepSearchJobs)
      .innerJoin(ideaJobs, eq(deepSearchJobs.ideaJobId, ideaJobs.ideaJobId))
      .where(
        and(
          eq(ideaJobs.debateJobId, debateJobId),
          eq(deepSearchJobs.status, "running"),
        ),
      )
      .get()
    if (unfinishedSearch) {
      throw new Error("Debate search research must settle before completion")
    }
    const result = transaction
      .update(debateJobs)
      .set({ status: "completed", completedAt: new Date() })
      .where(
        and(
          eq(debateJobs.debateJobId, debateJobId),
          eq(debateJobs.status, "running"),
          eq(debateJobs.stage, "final"),
        ),
      )
      .run()
    if (result.changes !== 1) throw new Error("Running debate job was not found")
  })
}

export function failDebateJob(debateJobId: string, message: string): void {
  db.transaction((transaction) => {
    assertEffectiveResearchRootRunning(transaction, {
      kind: "debate",
      jobId: debateJobId,
    })
    const result = transaction
      .update(debateJobs)
      .set({ status: "failed", error: message, completedAt: new Date() })
      .where(
        and(
          eq(debateJobs.debateJobId, debateJobId),
          eq(debateJobs.status, "running"),
        ),
      )
      .run()
    if (result.changes !== 1) throw new Error("Running debate job was not found")
  })
}

/** Settles the complete owned research tree before closing the debate root. */
export function interruptDebateJob(debateJobId: string, message: string): void {
  const child = db
    .select({ id: ideaJobs.ideaJobId, status: ideaJobs.status })
    .from(ideaJobs)
    .where(eq(ideaJobs.debateJobId, debateJobId))
    .get()
  if (child?.status === "running") {
    interruptIdeaJob(
      child.id,
      new WorkflowInterruptedError("parent-stop").message,
    )
  }

  const completedAt = new Date()
  db.transaction((transaction) => {
    transaction
      .update(llmGenerations)
      .set({
        status: "interrupted",
        error: message,
        completedAt,
      })
      .where(
        and(
          eq(llmGenerations.debateJobId, debateJobId),
          eq(llmGenerations.status, "running"),
        ),
      )
      .run()
    const job = transaction
      .select({ status: debateJobs.status })
      .from(debateJobs)
      .where(eq(debateJobs.debateJobId, debateJobId))
      .get()
    if (!job) throw new Error("Debate job was not found")
    if (job.status === "interrupted") return
    if (job.status !== "running") throw new Error("Debate job is already terminal")
    const result = transaction
      .update(debateJobs)
      .set({ status: "interrupted", error: message, completedAt })
      .where(
        and(
          eq(debateJobs.debateJobId, debateJobId),
          eq(debateJobs.status, "running"),
        ),
      )
      .run()
    if (result.changes !== 1) throw new Error("Running debate job was not found")
  })
}
