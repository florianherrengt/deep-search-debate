import { and, eq, inArray, isNull } from "drizzle-orm"

import { db } from "../../db/index.ts"
import {
  deepSearchJobs,
  ideaJobs,
  ideas,
  llmGenerations,
} from "../../db/schema/index.ts"
import type { TextStreamPersistenceTransaction } from "../../llms/streams.ts"
import { WorkflowInterruptedError } from "../../workflowRuntime.ts"
import { interruptDeepSearchJob } from "../deepSearch/jobLifecycle.ts"
import { assertEffectiveResearchRootRunning } from "../researchCancellation.ts"
import type { Idea, IdeaJobStage } from "./schemas.ts"

export type PersistedIdea = Idea & { ideaId: string; position: number }

function assertIdeaActive(
  transaction: TextStreamPersistenceTransaction,
  ideaJobId: string,
): void {
  assertEffectiveResearchRootRunning(transaction, {
    kind: "idea",
    jobId: ideaJobId,
  })
}

export function setIdeaJobGeneration(
  transaction: TextStreamPersistenceTransaction,
  input: {
    ideaJobId: string
    field:
      | "researchPromptGenerationId"
      | "researchSummaryGenerationId"
      | "ideaGenerationId"
      | "selectionGenerationId"
    generationId: string
  },
): void {
  assertIdeaActive(transaction, input.ideaJobId)
  const generationColumn = ideaJobs[input.field]
  const result = transaction
    .update(ideaJobs)
    .set({ [input.field]: input.generationId })
    .where(
      and(
        eq(ideaJobs.ideaJobId, input.ideaJobId),
        eq(ideaJobs.status, "running"),
        isNull(generationColumn),
      ),
    )
    .run()
  if (result.changes !== 1) throw new Error("Running idea job was not found")
}

export function setIdeaJobStage(
  ideaJobId: string,
  stage: IdeaJobStage,
): void {
  const expectedStage: IdeaJobStage =
    stage === "research"
      ? "planning"
      : stage === "summary"
        ? "research"
        : "summary"
  db.transaction((transaction) => {
    assertIdeaActive(transaction, ideaJobId)
    const result = transaction
      .update(ideaJobs)
      .set({ stage })
      .where(
        and(
          eq(ideaJobs.ideaJobId, ideaJobId),
          eq(ideaJobs.status, "running"),
          eq(ideaJobs.stage, expectedStage),
        ),
      )
      .run()
    if (result.changes !== 1) throw new Error("Running idea job was not found")
  })
}

export function insertIdeaBatch(
  ideaJobId: string,
  generatedIdeas: Idea[],
): PersistedIdea[] {
  const persistedIdeas = generatedIdeas.map((idea, position) => ({
    ideaId: crypto.randomUUID(),
    position,
    ...idea,
  }))
  db.transaction((transaction) => {
    assertIdeaActive(transaction, ideaJobId)
    transaction
      .insert(ideas)
      .values(persistedIdeas.map((idea) => ({ ...idea, ideaJobId })))
      .run()
  })
  return persistedIdeas
}

export function completeIdeaJob(ideaJobId: string): void {
  db.transaction((transaction) => {
    assertIdeaActive(transaction, ideaJobId)
    const job = transaction
      .select({
        stage: ideaJobs.stage,
        numberOfIdeas: ideaJobs.numberOfIdeas,
        deepSearchCount: ideaJobs.deepSearchCount,
        researchPromptGenerationId: ideaJobs.researchPromptGenerationId,
        researchSummaryGenerationId: ideaJobs.researchSummaryGenerationId,
        ideaGenerationId: ideaJobs.ideaGenerationId,
        selectionGenerationId: ideaJobs.selectionGenerationId,
      })
      .from(ideaJobs)
      .where(eq(ideaJobs.ideaJobId, ideaJobId))
      .get()
    if (!job) throw new Error("Idea job was not found")
    const pipelineGenerationIds = [
      job.researchPromptGenerationId,
      job.researchSummaryGenerationId,
      job.ideaGenerationId,
      job.selectionGenerationId,
    ]
    if (job.stage !== "ideas" || pipelineGenerationIds.some((id) => !id)) {
      throw new Error("Every idea pipeline stage must start before completion")
    }
    const persistedIdeas = transaction
      .select({
        position: ideas.position,
        evaluationGenerationId: ideas.evaluationGenerationId,
        selected: ideas.selected,
        refinementGenerationId: ideas.refinementGenerationId,
        refinedTitle: ideas.refinedTitle,
        refinedDescription: ideas.refinedDescription,
      })
      .from(ideas)
      .where(eq(ideas.ideaJobId, ideaJobId))
      .all()
    if (
      persistedIdeas.length !== job.numberOfIdeas ||
      persistedIdeas.some(({ selected }) => selected === null)
    ) {
      throw new Error("Every generated idea must be selected or rejected")
    }
    const selectedIdeas = persistedIdeas.filter(({ selected }) => selected)
    if (
      selectedIdeas.some(
        ({
          evaluationGenerationId,
          refinementGenerationId,
          refinedTitle,
          refinedDescription,
        }) =>
          evaluationGenerationId === null ||
          refinementGenerationId === null ||
          refinedTitle === null ||
          refinedDescription === null,
      )
    ) {
      throw new Error("Every selected idea must be refined")
    }
    const generationIds = [
      ...pipelineGenerationIds,
      ...selectedIdeas.map(({ evaluationGenerationId }) =>
        evaluationGenerationId,
      ),
      ...selectedIdeas.map(({ refinementGenerationId }) =>
        refinementGenerationId,
      ),
    ].filter((id): id is string => id !== null)
    const completedGenerationCount = transaction
      .select({ id: llmGenerations.llmGenerationId })
      .from(llmGenerations)
      .where(
        and(
          inArray(llmGenerations.llmGenerationId, generationIds),
          eq(llmGenerations.status, "completed"),
        ),
      )
      .all().length
    if (completedGenerationCount !== generationIds.length) {
      throw new Error("Every idea generation must complete before its parent")
    }
    const completedChildren = new Set(
      transaction
        .select({ position: deepSearchJobs.ideaJobPosition })
        .from(deepSearchJobs)
        .where(
          and(
            eq(deepSearchJobs.ideaJobId, ideaJobId),
            eq(deepSearchJobs.status, "completed"),
          ),
        )
        .all()
        .map(({ position }) => position),
    )
    const expectedChildPositions = [
      ...Array.from({ length: job.deepSearchCount }, (_, position) => position),
      ...selectedIdeas.map(
        ({ position }) => job.deepSearchCount + position,
      ),
    ]
    if (
      expectedChildPositions.some(
        (position) => !completedChildren.has(position),
      )
    ) {
      throw new Error("Every idea research child must complete before its parent")
    }
    const activeGeneration = transaction
      .select({ id: llmGenerations.llmGenerationId })
      .from(llmGenerations)
      .where(
        and(
          eq(llmGenerations.ideaJobId, ideaJobId),
          eq(llmGenerations.status, "running"),
        ),
      )
      .get()
    if (activeGeneration) {
      throw new Error("Idea generations must settle before parent completion")
    }
    const activeChild = transaction
      .select({ id: deepSearchJobs.deepSearchJobId })
      .from(deepSearchJobs)
      .where(
        and(
          eq(deepSearchJobs.ideaJobId, ideaJobId),
          eq(deepSearchJobs.status, "running"),
        ),
      )
      .get()
    if (activeChild) {
      throw new Error("Idea research must settle before parent completion")
    }
    const result = transaction
      .update(ideaJobs)
      .set({ status: "completed", completedAt: new Date() })
      .where(
        and(
          eq(ideaJobs.ideaJobId, ideaJobId),
          eq(ideaJobs.status, "running"),
        ),
      )
      .run()
    if (result.changes !== 1) throw new Error("Running idea job was not found")
  })
}

export function failIdeaJob(
  ideaJobId: string,
  stage: IdeaJobStage,
  message: string,
): void {
  db.transaction((transaction) => {
    assertIdeaActive(transaction, ideaJobId)
    const result = transaction
      .update(ideaJobs)
      .set({ stage, status: "failed", error: message, completedAt: new Date() })
      .where(
        and(
          eq(ideaJobs.ideaJobId, ideaJobId),
          eq(ideaJobs.status, "running"),
        ),
      )
      .run()
    if (result.changes !== 1) throw new Error("Running idea job was not found")
  })
}

/** Settles descendants first, then closes the idea parent as interrupted. */
export function interruptIdeaJob(ideaJobId: string, message: string): void {
  const childIds = db
    .select({ id: deepSearchJobs.deepSearchJobId })
    .from(deepSearchJobs)
    .where(
      and(
        eq(deepSearchJobs.ideaJobId, ideaJobId),
        eq(deepSearchJobs.status, "running"),
      ),
    )
    .all()
    .map(({ id }) => id)
  const childMessage = new WorkflowInterruptedError("parent-stop").message
  for (const childId of childIds) interruptDeepSearchJob(childId, childMessage)

  const completedAt = new Date()
  db.transaction((transaction) => {
    transaction
      .update(llmGenerations)
      .set({ status: "interrupted", error: message, completedAt })
      .where(
        and(
          eq(llmGenerations.ideaJobId, ideaJobId),
          eq(llmGenerations.status, "running"),
        ),
      )
      .run()
    const job = transaction
      .select({ status: ideaJobs.status })
      .from(ideaJobs)
      .where(eq(ideaJobs.ideaJobId, ideaJobId))
      .get()
    if (!job) throw new Error("Idea job was not found")
    if (job.status === "interrupted") return
    if (job.status !== "running") throw new Error("Idea job is already terminal")
    const result = transaction
      .update(ideaJobs)
      .set({ status: "interrupted", error: message, completedAt })
      .where(
        and(
          eq(ideaJobs.ideaJobId, ideaJobId),
          eq(ideaJobs.status, "running"),
        ),
      )
      .run()
    if (result.changes !== 1) throw new Error("Running idea job was not found")
  })
}
