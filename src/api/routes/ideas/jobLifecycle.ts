import { and, asc, eq, inArray, isNull } from "drizzle-orm"

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

export type PersistedIdeaGeneration = {
  generationId: string
  status: "running" | "completed" | "failed" | "interrupted"
  text: string | null
  error: string | null
}

export type PersistedIdea = Idea & {
  ideaId: string
  position: number
  selected: boolean | null
  refinementGeneration: PersistedIdeaGeneration | null
  refinedTitle: string | null
  refinedDescription: string | null
  evaluationGeneration: PersistedIdeaGeneration | null
}

type PersistedIdeaChild = {
  deepSearchJobId: string
  position: number
  title: string
  slug: string
  researchRequest: string
  status: "running" | "completed" | "failed" | "interrupted"
  finalAnswer: string | null
}

export type IdeaExecutionSnapshot = {
  ideaJobId: string
  userId: string
  prompt: string
  numberOfIdeas: number
  deepSearchCount: number
  maxSearches: number
  maxResultsPerSearch: number
  maxRounds: number
  status: "running" | "completed" | "failed" | "interrupted"
  researchPromptGeneration: PersistedIdeaGeneration | null
  researchSummaryGeneration: PersistedIdeaGeneration | null
  ideaGeneration: PersistedIdeaGeneration | null
  selectionGeneration: PersistedIdeaGeneration | null
  ideas: PersistedIdea[]
  children: PersistedIdeaChild[]
}

function toPersistedGeneration(
  generation: typeof llmGenerations.$inferSelect,
): PersistedIdeaGeneration {
  return {
    generationId: generation.llmGenerationId,
    status: generation.status,
    text: generation.text,
    error: generation.error,
  }
}

/** Loads the complete durable checkpoint graph needed to resume one idea job. */
export function loadIdeaExecutionSnapshot(
  ideaJobId: string,
): IdeaExecutionSnapshot | undefined {
  const job = db
    .select()
    .from(ideaJobs)
    .where(eq(ideaJobs.ideaJobId, ideaJobId))
    .get()
  if (!job) return undefined

  const persistedIdeas = db
    .select()
    .from(ideas)
    .where(eq(ideas.ideaJobId, ideaJobId))
    .orderBy(asc(ideas.position), asc(ideas.ideaId))
    .all()
  const children = db
    .select()
    .from(deepSearchJobs)
    .where(eq(deepSearchJobs.ideaJobId, ideaJobId))
    .orderBy(
      asc(deepSearchJobs.ideaJobPosition),
      asc(deepSearchJobs.deepSearchJobId),
    )
    .all()

  const generationIds = new Set<string>()
  const addGenerationId = (generationId: string | null): void => {
    if (generationId !== null) generationIds.add(generationId)
  }
  addGenerationId(job.researchPromptGenerationId)
  addGenerationId(job.researchSummaryGenerationId)
  addGenerationId(job.ideaGenerationId)
  addGenerationId(job.selectionGenerationId)
  for (const idea of persistedIdeas) {
    addGenerationId(idea.refinementGenerationId)
    addGenerationId(idea.evaluationGenerationId)
  }
  for (const child of children) addGenerationId(child.finalAnswerGenerationId)
  const generations = generationIds.size === 0
    ? []
    : db
        .select()
        .from(llmGenerations)
        .where(inArray(llmGenerations.llmGenerationId, [...generationIds]))
        .all()
  const generationsById = new Map(
    generations.map((generation) => [
      generation.llmGenerationId,
      toPersistedGeneration(generation),
    ]),
  )
  const getGeneration = (
    generationId: string | null,
  ): PersistedIdeaGeneration | null => {
    if (generationId === null) return null
    const generation = generationsById.get(generationId)
    if (!generation) {
      throw new Error(`Linked LLM generation was not found: ${generationId}`)
    }
    return generation
  }

  return {
    ideaJobId: job.ideaJobId,
    userId: job.userId,
    prompt: job.prompt,
    numberOfIdeas: job.numberOfIdeas,
    deepSearchCount: job.deepSearchCount,
    maxSearches: job.maxSearches,
    maxResultsPerSearch: job.maxResultsPerSearch,
    maxRounds: job.maxRounds,
    status: job.status,
    researchPromptGeneration: getGeneration(job.researchPromptGenerationId),
    researchSummaryGeneration: getGeneration(job.researchSummaryGenerationId),
    ideaGeneration: getGeneration(job.ideaGenerationId),
    selectionGeneration: getGeneration(job.selectionGenerationId),
    ideas: persistedIdeas.map((idea) => ({
      ideaId: idea.ideaId,
      position: idea.position,
      title: idea.title,
      description: idea.description,
      selected: idea.selected,
      refinementGeneration: getGeneration(idea.refinementGenerationId),
      refinedTitle: idea.refinedTitle,
      refinedDescription: idea.refinedDescription,
      evaluationGeneration: getGeneration(idea.evaluationGenerationId),
    })),
    children: children.map((child) => ({
      deepSearchJobId: child.deepSearchJobId,
      position: child.ideaJobPosition ?? (() => {
        throw new Error("Idea-owned deep search is missing its position")
      })(),
      title: child.title,
      slug: child.slug,
      researchRequest: child.researchRequest,
      status: child.status,
      finalAnswer: child.finalAnswerGenerationId === null
        ? null
        : (() => {
            const generation = getGeneration(child.finalAnswerGenerationId)
            return generation?.status === "completed" ? generation.text : null
          })(),
    })),
  }
}

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
    expectedGenerationId: string | null
  },
): void {
  assertIdeaActive(transaction, input.ideaJobId)
  const generationColumn = ideaJobs[input.field]
  if (input.expectedGenerationId !== null) {
    interruptStaleGeneration(
      transaction,
      input.ideaJobId,
      input.expectedGenerationId,
    )
  }
  const result = transaction
    .update(ideaJobs)
    .set({ [input.field]: input.generationId })
    .where(
      and(
        eq(ideaJobs.ideaJobId, input.ideaJobId),
        eq(ideaJobs.status, "running"),
        input.expectedGenerationId === null
          ? isNull(generationColumn)
          : eq(generationColumn, input.expectedGenerationId),
      ),
    )
    .run()
  if (result.changes !== 1) throw new Error("Running idea job was not found")
}

function interruptStaleGeneration(
  transaction: TextStreamPersistenceTransaction,
  ideaJobId: string,
  generationId: string,
): void {
  const generation = transaction
    .select({
      ideaJobId: llmGenerations.ideaJobId,
      status: llmGenerations.status,
    })
    .from(llmGenerations)
    .where(eq(llmGenerations.llmGenerationId, generationId))
    .get()
  if (generation?.ideaJobId !== ideaJobId) {
    throw new Error("LLM generation must belong to the idea job")
  }
  if (generation.status === "completed") {
    throw new Error("A completed idea generation cannot be replaced")
  }
  if (generation.status !== "running") return
  const result = transaction
    .update(llmGenerations)
    .set({
      status: "interrupted",
      error: "Interrupted by workflow recovery",
      completedAt: new Date(),
    })
    .where(
      and(
        eq(llmGenerations.llmGenerationId, generationId),
        eq(llmGenerations.status, "running"),
      ),
    )
    .run()
  if (result.changes !== 1) {
    throw new Error("Stale idea generation was not interrupted")
  }
}

export function setIdeaGeneration(
  transaction: TextStreamPersistenceTransaction,
  input: {
    ideaJobId: string
    ideaId: string
    field: "refinementGenerationId" | "evaluationGenerationId"
    generationId: string
    expectedGenerationId: string | null
  },
): void {
  assertIdeaActive(transaction, input.ideaJobId)
  if (input.expectedGenerationId !== null) {
    interruptStaleGeneration(
      transaction,
      input.ideaJobId,
      input.expectedGenerationId,
    )
  }
  const generationColumn = ideas[input.field]
  const result = transaction
    .update(ideas)
    .set({ [input.field]: input.generationId })
    .where(
      and(
        eq(ideas.ideaId, input.ideaId),
        eq(ideas.ideaJobId, input.ideaJobId),
        eq(ideas.selected, true),
        input.expectedGenerationId === null
          ? isNull(generationColumn)
          : eq(generationColumn, input.expectedGenerationId),
      ),
    )
    .run()
  if (result.changes !== 1) throw new Error("Selected idea was not found")
}

export function setIdeaJobStage(
  ideaJobId: string,
  stage: IdeaJobStage,
): void {
  db.transaction((transaction) => {
    assertIdeaActive(transaction, ideaJobId)
    const job = transaction
      .select({ stage: ideaJobs.stage })
      .from(ideaJobs)
      .where(eq(ideaJobs.ideaJobId, ideaJobId))
      .get()
    if (!job) throw new Error("Idea job was not found")
    const stages: IdeaJobStage[] = ["planning", "research", "summary", "ideas"]
    if (stages.indexOf(job.stage) >= stages.indexOf(stage)) return
    const result = transaction
      .update(ideaJobs)
      .set({ stage })
      .where(
        and(
          eq(ideaJobs.ideaJobId, ideaJobId),
          eq(ideaJobs.status, "running"),
          eq(ideaJobs.stage, job.stage),
        ),
      )
      .run()
    if (result.changes !== 1) throw new Error("Running idea job was not found")
  })
}

export function insertIdeaBatch(
  transaction: TextStreamPersistenceTransaction,
  ideaJobId: string,
  generatedIdeas: Idea[],
): PersistedIdea[] {
  const persistedIdeas = generatedIdeas.map((idea, position) => ({
    ideaId: crypto.randomUUID(),
    position,
    ...idea,
  }))
  assertIdeaActive(transaction, ideaJobId)
  transaction
    .insert(ideas)
    .values(persistedIdeas.map((idea) => ({ ...idea, ideaJobId })))
    .run()
  return persistedIdeas.map((idea) => ({
    ...idea,
    selected: null,
    refinementGeneration: null,
    refinedTitle: null,
    refinedDescription: null,
    evaluationGeneration: null,
  }))
}

/** Reopens a parked idea root without mutating its linked stage attempts. */
export function reopenIdeaJob(ideaJobId: string): void {
  db.transaction((transaction) => {
    const job = transaction
      .select({ status: ideaJobs.status })
      .from(ideaJobs)
      .where(eq(ideaJobs.ideaJobId, ideaJobId))
      .get()
    if (!job) throw new Error("Idea job was not found")
    if (job.status === "completed") {
      throw new Error("Completed idea jobs cannot be resumed")
    }
    const result = transaction
      .update(ideaJobs)
      .set({
        status: "running",
        error: null,
        completedAt: null,
        cancelRequestedAt: null,
      })
      .where(
        and(
          eq(ideaJobs.ideaJobId, ideaJobId),
          inArray(ideaJobs.status, ["running", "failed", "interrupted"]),
        ),
      )
      .run()
    if (result.changes !== 1) throw new Error("Idea job could not be reopened")
  })
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
