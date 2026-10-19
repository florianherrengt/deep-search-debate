import { and, eq } from "drizzle-orm"
import { beforeEach, describe, expect, it, vi } from "vitest"

const mocks = vi.hoisted(() => ({
  prepareQuestionBatch: vi.fn(),
  generateObjectStream: vi.fn(),
}))

vi.mock("./controller.ts", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./controller.ts")>()
  return { ...actual, prepareQuestionBatch: mocks.prepareQuestionBatch }
})
vi.mock("../../llms/generateText.ts", () => ({
  generateObjectStream: mocks.generateObjectStream,
}))

import { db } from "../../db/index.ts"
import {
  deepSearchJobs,
  llmGenerations,
  refineSearchLinks,
  refineSessions,
  refineBatches,
} from "../../db/schema/index.ts"
import { config } from "../../config.ts"
import { PromptName } from "../../llms/prompts.ts"
import type { DeepSearchJobManager } from "../deepSearch/manager.ts"
import { createRefineSessionManager } from "./manager.ts"
import { refinePipelineCheckpointSchema, type RefineAnswerInput } from "./schemas.ts"
import { emptyRefineState } from "./controller.ts"

function fakeDeepSearchManager(onStart?: (role: "preparation" | "research" | undefined, researchRequest: string) => void): DeepSearchJobManager {
  return {
    start(userId, input, options) {
      onStart?.(options?.refineLink?.role, input.researchRequest)
      const id = input.deepSearchJobId ?? crypto.randomUUID()
      const slug = `search-${id}`
      const generationId = crypto.randomUUID()
      db.transaction((tx) => {
        tx.insert(deepSearchJobs).values({
          deepSearchJobId: id,
          userId,
          title: "Refine search",
          slug,
          researchRequest: input.researchRequest,
          maxSearches: input.maxSearches ?? 3,
          maxResultsPerSearch: input.maxResultsPerSearch ?? 3,
          maxRounds: input.maxRounds ?? Math.min(3, config.deepSearch.maxRounds),
          strictQuality: false,
          status: "running",
          finalAnswerGenerationId: null,
        }).run()
        tx.insert(llmGenerations).values({ llmGenerationId: generationId, userId, deepSearchJobId: id, status: "completed", text: "Persisted research evidence", reasoning: "", completedAt: new Date() }).run()
        tx.update(deepSearchJobs).set({ status: "completed", finalAnswerGenerationId: generationId, completedAt: new Date() }).where(eq(deepSearchJobs.deepSearchJobId, id)).run()
        if (options?.refineLink) {
          const link = options.refineLink
          tx.insert(refineSearchLinks).values({
            refineSearchLinkId: crypto.randomUUID(),
            refineSessionId: link.refineSessionId,
            refineBatchId: link.refineBatchId ?? null,
            deepSearchJobId: id,
            userId,
            role: link.role,
            position: link.position ?? null,
          }).run()
          if (link.role === "research") {
            tx.update(refineSessions).set({ status: "research-started" })
              .where(eq(refineSessions.refineSessionId, link.refineSessionId)).run()
          }
        }
      }, { behavior: "immediate" })
      return Promise.resolve({ deepSearchJobId: id, slug, title: "Refine search", completion: Promise.resolve("Persisted research evidence") })
    },
    resumeExisting() { throw new Error("Unexpected resume") },
    stop() { return { requested: false } as never },
    getLiveJob() { return undefined },
  }
}

function questionBatch() {
  return {
    action: "ASK_USER" as const,
    toolResearchRequests: [],
    reason: "A user choice remains.",
    questions: [{
      id: crypto.randomUUID(),
      prompt: "Which scope should the report cover?",
      needIds: ["need-id"],
      decisionIds: ["decision-id"],
      evidenceRefs: ["evidence"],
      candidates: [{ id: crypto.randomUUID(), label: "Local" }, { id: crypto.randomUUID(), label: "Global" }],
    }],
    state: emptyRefineState(),
  }
}

type GenerationTransaction = Parameters<Parameters<typeof db.transaction>[0]>[0]
type CondenseOutput = { researchRequest: string }
type CondenseInput = {
  userId: string
  promptName: PromptName
  prompt: string
  schema: { parse(value: unknown): CondenseOutput }
  onRegistered?: (id: string, transaction: GenerationTransaction) => void
  onCompleted?: (result: { id: string; output: CondenseOutput }, transaction: GenerationTransaction) => void
  onFailed?: (result: { id: string; text: string; reasoning: string; error: string }, transaction: GenerationTransaction) => void
}

function mockCondensation(output: (input: CondenseInput) => unknown): void {
  mocks.generateObjectStream.mockImplementation((rawInput: CondenseInput) => {
    const id = crypto.randomUUID()
    db.transaction((transaction) => {
      transaction.insert(llmGenerations).values({
        llmGenerationId: id,
        userId: rawInput.userId,
        promptName: rawInput.promptName,
        status: "running",
      }).run()
      rawInput.onRegistered?.(id, transaction)
    }, { behavior: "immediate" })
    let parsed: CondenseOutput
    try {
      parsed = rawInput.schema.parse(output(rawInput))
    } catch (error) {
      const message = error instanceof Error ? error.message : "Invalid mocked condensation output"
      db.transaction((transaction) => {
        transaction.update(llmGenerations).set({ status: "failed", error: message, text: "", reasoning: "", completedAt: new Date() })
          .where(eq(llmGenerations.llmGenerationId, id)).run()
        rawInput.onFailed?.({ id, text: "", reasoning: "", error: message }, transaction)
      }, { behavior: "immediate" })
      throw error
    }
    db.transaction((transaction) => {
      transaction.update(llmGenerations).set({ status: "completed", text: JSON.stringify(parsed), reasoning: "", completedAt: new Date() })
        .where(eq(llmGenerations.llmGenerationId, id)).run()
      rawInput.onCompleted?.({ id, output: parsed }, transaction)
    }, { behavior: "immediate" })
    return {
      id,
      completion: Promise.resolve({ status: "completed" as const, text: JSON.stringify(parsed), reasoning: "" }),
      output: Promise.resolve(parsed),
    }
  })
}

describe("Refine session persistence", () => {
  it("rejects malformed persisted preparation checkpoints", () => {
    expect(refinePipelineCheckpointSchema.parse({ prepJobIds: {}, stageGenerationIds: {}, stageOutputs: {}, evidence: [], targetedRequests: {}, currentPosition: 0 })).toEqual({
      prepJobIds: {}, stageGenerationIds: {}, stageOutputs: {}, evidence: [], targetedRequests: {}, currentPosition: 0,
    })
    expect(() => refinePipelineCheckpointSchema.parse({ prepJobIds: [], stageGenerationIds: {}, stageOutputs: {}, evidence: [], targetedRequests: {}, currentPosition: 0 })).toThrow()
    expect(() => refinePipelineCheckpointSchema.parse({ prepJobIds: {}, stageGenerationIds: { stage: "not-a-uuid" }, stageOutputs: {}, evidence: [], targetedRequests: {}, currentPosition: 0 })).toThrow()
    expect(() => refinePipelineCheckpointSchema.parse({ prepJobIds: { nope: "not-a-uuid" }, stageGenerationIds: {}, stageOutputs: {}, evidence: [], targetedRequests: {}, currentPosition: -1 })).toThrow()
  })

  beforeEach(() => {
    vi.clearAllMocks()
    db.delete(refineSessions).run()
    db.delete(deepSearchJobs).run()
    mocks.prepareQuestionBatch.mockImplementation(() => Promise.resolve(questionBatch()))
    mocks.generateObjectStream.mockReset()
  })


  it("rejects an active batch pointer owned by another session", () => {
    const firstId = crypto.randomUUID()
    const secondId = crypto.randomUUID()
    const firstBatchId = crypto.randomUUID()
    const secondBatchId = crypto.randomUUID()
    for (const [refineSessionId, batchId] of [[firstId, firstBatchId], [secondId, secondBatchId]]) {
      db.insert(refineSessions).values({ refineSessionId, userId: "test-user-id", originalPrompt: "Prompt", status: "clarifying", activeBatchId: null }).run()
      db.insert(refineBatches).values({ refineBatchId: batchId, refineSessionId, position: 0, status: "preparing" }).run()
    }
    expect(() => db.update(refineSessions).set({ activeBatchId: secondBatchId }).where(eq(refineSessions.refineSessionId, firstId)).run()).toThrow(/FOREIGN KEY constraint failed/)
  })

  it("interrupts only its registered running stage attempt and reuses successful stage checkpoints on recovery", async () => {
    const manager = createRefineSessionManager(fakeDeepSearchManager())
    const sessionId = crypto.randomUUID()
    const batchId = crypto.randomUUID()
    const generationId = crypto.randomUUID()
    const prepJobId = crypto.randomUUID()
    const prepAnswerId = crypto.randomUUID()
    db.transaction((transaction) => {
      transaction.insert(refineSessions).values({
        refineSessionId: sessionId,
        userId: "test-user-id",
        originalPrompt: "Recover the interrupted preparation",
        status: "clarifying",
        activeBatchId: null,
      }).run()
      transaction.insert(refineBatches).values({
        refineBatchId: batchId,
        refineSessionId: sessionId,
        position: 0,
        status: "preparing",
        stageCheckpoints: JSON.stringify({
          prepJobIds: {},
          stageGenerationIds: { "recover-context": generationId },
          stageOutputs: { "integrate-answers": { previouslyCompleted: true } },
          evidence: ["previous evidence"],
          targetedRequests: {},
          currentPosition: 0,
        }),
      }).run()
      transaction.update(refineSessions).set({ activeBatchId: batchId }).where(eq(refineSessions.refineSessionId, sessionId)).run()
      transaction.insert(llmGenerations).values({
        llmGenerationId: generationId,
        userId: "test-user-id",
        promptName: PromptName.RefineRecoverContext,
        status: "running",
      }).run()
      transaction.insert(deepSearchJobs).values({
        deepSearchJobId: prepJobId,
        userId: "test-user-id",
        title: "Existing preparation evidence",
        slug: `search-${prepJobId}`,
        researchRequest: "Prepare the same evidence",
        maxSearches: 3,
        maxResultsPerSearch: 3,
        maxRounds: 3,
        strictQuality: false,
        status: "running",
        finalAnswerGenerationId: null,
        completedAt: null,
      }).run()
      transaction.insert(llmGenerations).values({
        llmGenerationId: prepAnswerId,
        userId: "test-user-id",
        deepSearchJobId: prepJobId,
        status: "completed",
        text: "previous evidence",
        reasoning: "",
        completedAt: new Date(),
      }).run()
      transaction.update(deepSearchJobs).set({ status: "completed", finalAnswerGenerationId: prepAnswerId, completedAt: new Date() })
        .where(eq(deepSearchJobs.deepSearchJobId, prepJobId)).run()
      transaction.insert(refineSearchLinks).values({
        refineSearchLinkId: crypto.randomUUID(),
        refineSessionId: sessionId,
        refineBatchId: batchId,
        deepSearchJobId: prepJobId,
        userId: "test-user-id",
        role: "preparation",
        position: 0,
      }).run()
    }, { behavior: "immediate" })

    manager.reconcilePersisted()
    await vi.waitFor(() => expect(manager.get("test-user-id", sessionId)?.batches[0]?.status).toBe("ready"))
    expect(db.select().from(llmGenerations).where(eq(llmGenerations.llmGenerationId, generationId)).get()).toMatchObject({
      userId: "test-user-id",
      promptName: PromptName.RefineRecoverContext,
      status: "interrupted",
    })
    expect(mocks.prepareQuestionBatch.mock.calls[0]?.[0]).toMatchObject({
      checkpoints: { "integrate-answers": { previouslyCompleted: true } },
    })
    expect(manager.get("test-user-id", sessionId)?.batches[0]?.status).toBe("ready")
  })

  it("explicit retry evicts only a failed stage and its downstream checkpoints while preserving prior work", async () => {
    const manager = createRefineSessionManager(fakeDeepSearchManager())
    mocks.prepareQuestionBatch.mockImplementationOnce(() => Promise.reject(new Error("A stage failed")))
    const created = manager.create("test-user-id", "Research a supported choice")
    await vi.waitFor(() => expect(manager.get("test-user-id", created.id)?.batches[0]?.status).toBe("failed"))
    const initial = manager.get("test-user-id", created.id)!
    const batchId = initial.batches[0].id
    const before = db.select().from(refineBatches).where(eq(refineBatches.refineBatchId, batchId)).get()!
    const pipeline = JSON.parse(before.stageCheckpoints) as {
      prepJobIds: Record<string, string>
      evidence: string[]
      stageOutputs: Record<string, unknown>
    }
    pipeline.stageOutputs = {
      "recover-context": { preserved: "earlier valid output" },
      "integrate-answers": { preserved: "earlier valid output" },
      "generate-questions": { preserved: "valid source candidates" },
      "review-questions": { invalid: true },
      "choose-action": { stale: true },
      "present-questions": { stale: true },
      "shared-state": { preserved: "valid frozen state" },
    }
    db.update(refineBatches).set({ stageCheckpoints: JSON.stringify(pipeline) }).where(eq(refineBatches.refineBatchId, batchId)).run()

    let checkpointsSeen: Record<string, unknown> | undefined
    mocks.prepareQuestionBatch.mockImplementationOnce((input: {
      checkpoints: Record<string, unknown>
      recoverInvalidCheckpoint?: (stage: string, error: unknown) => boolean
    }) => {
      const recovered = input.recoverInvalidCheckpoint?.("review-questions", new Error("Cached review is invalid"))
      if (!recovered) throw new Error("Explicit retry did not evict the invalid stage")
      checkpointsSeen = { ...input.checkpoints }
      return Promise.resolve(questionBatch())
    })
    manager.retry("test-user-id", created.id, batchId)
    await vi.waitFor(() => expect(manager.get("test-user-id", created.id)?.batches[0]?.status).toBe("ready"))

    expect(checkpointsSeen).toEqual({
      "recover-context": { preserved: "earlier valid output" },
      "integrate-answers": { preserved: "earlier valid output" },
      "generate-questions": { preserved: "valid source candidates" },
      "shared-state": { preserved: "valid frozen state" },
    })
    const after = JSON.parse(db.select().from(refineBatches).where(eq(refineBatches.refineBatchId, batchId)).get()!.stageCheckpoints) as typeof pipeline
    expect(after.prepJobIds).toEqual(pipeline.prepJobIds)
    expect(after.evidence).toEqual(pipeline.evidence)
    expect(after.stageOutputs).toEqual(checkpointsSeen)
    expect(manager.get("test-user-id", created.id)?.prepSearches).toHaveLength(1)
  })

  it("settles a registered stage attempt before recovering a persisted starting handoff", async () => {
    const manager = createRefineSessionManager(fakeDeepSearchManager())
    const sessionId = crypto.randomUUID()
    const batchId = crypto.randomUUID()
    const generationId = crypto.randomUUID()
    const finalJobId = crypto.randomUUID()
    db.transaction((transaction) => {
      transaction.insert(refineSessions).values({
        refineSessionId: sessionId,
        userId: "test-user-id",
        originalPrompt: "Finish the requested research",
        status: "starting",
        activeBatchId: null,
        finalDeepSearchJobId: finalJobId,
        finalResearchRequest: "Original request and unanswered clarification record",
      }).run()
      transaction.insert(refineBatches).values({
        refineBatchId: batchId,
        refineSessionId: sessionId,
        position: 0,
        status: "submitted",
        answers: "[]",
        stageCheckpoints: JSON.stringify({
          prepJobIds: {},
          stageGenerationIds: { "recover-context": generationId },
          stageOutputs: {},
          evidence: [],
          targetedRequests: {},
          currentPosition: 0,
        }),
      }).run()
      transaction.update(refineSessions).set({ activeBatchId: batchId }).where(eq(refineSessions.refineSessionId, sessionId)).run()
      transaction.insert(llmGenerations).values({
        llmGenerationId: generationId,
        userId: "test-user-id",
        promptName: PromptName.RefineRecoverContext,
        status: "running",
      }).run()
    }, { behavior: "immediate" })

    manager.reconcilePersisted()
    await vi.waitFor(() => expect(manager.get("test-user-id", sessionId)?.status).toBe("research-started"))
    expect(db.select().from(llmGenerations).where(eq(llmGenerations.llmGenerationId, generationId)).get()).toMatchObject({ status: "interrupted" })
    expect(db.select().from(refineSearchLinks).where(and(eq(refineSearchLinks.refineSessionId, sessionId), eq(refineSearchLinks.role, "research"))).all()).toHaveLength(1)
  })

  it("recovers an interrupted final condensation with the reserved research job", async () => {
    const manager = createRefineSessionManager(fakeDeepSearchManager())
    const sessionId = crypto.randomUUID()
    const batchId = crypto.randomUUID()
    const generationId = crypto.randomUUID()
    const finalJobId = crypto.randomUUID()
    const oversizedRequest = `Original request: ${"Preserve every stated condition. ".repeat(400)}`
    db.transaction((transaction) => {
      transaction.insert(refineSessions).values({
        refineSessionId: sessionId,
        userId: "test-user-id",
        originalPrompt: "Preserve every stated condition.",
        status: "starting",
        activeBatchId: null,
        finalDeepSearchJobId: finalJobId,
        finalResearchRequest: oversizedRequest,
      }).run()
      transaction.insert(refineBatches).values({
        refineBatchId: batchId,
        refineSessionId: sessionId,
        position: 0,
        status: "submitted",
        answers: "[]",
        stageCheckpoints: JSON.stringify({
          prepJobIds: {},
          stageGenerationIds: { "condense-research:0": generationId },
          stageOutputs: {},
          evidence: [],
          targetedRequests: {},
          currentPosition: 0,
        }),
      }).run()
      transaction.insert(llmGenerations).values({
        llmGenerationId: generationId,
        userId: "test-user-id",
        promptName: PromptName.RefineCondenseResearchRequest,
        status: "running",
      }).run()
      transaction.update(refineSessions).set({ activeBatchId: batchId })
        .where(eq(refineSessions.refineSessionId, sessionId)).run()
    }, { behavior: "immediate" })
    mockCondensation(() => ({ researchRequest: "Recovered bounded research request." }))

    manager.reconcilePersisted()
    await vi.waitFor(() => expect(manager.get("test-user-id", sessionId)?.status).toBe("research-started"))

    expect(db.select().from(llmGenerations).where(eq(llmGenerations.llmGenerationId, generationId)).get()).toMatchObject({ status: "interrupted" })
    expect(db.select().from(refineSessions).where(eq(refineSessions.refineSessionId, sessionId)).get()?.finalResearchRequest)
      .toBe("Recovered bounded research request.")
    const links = db.select().from(refineSearchLinks).where(and(eq(refineSearchLinks.refineSessionId, sessionId), eq(refineSearchLinks.role, "research"))).all()
    expect(links).toHaveLength(1)
    expect(links[0]?.deepSearchJobId).toBe(finalJobId)
    expect(db.select().from(deepSearchJobs).where(eq(deepSearchJobs.deepSearchJobId, finalJobId)).get()?.researchRequest)
      .toBe("Recovered bounded research request.")
  })

  it("keeps drafts private, submits immutable answers, and retains batch history", async () => {
    const manager = createRefineSessionManager(fakeDeepSearchManager())
    const created = manager.create("test-user-id", "Research the best local option")
    await vi.waitFor(() => {
      const batch = manager.get("test-user-id", created.id)?.batches[0]
      if (batch?.status === "failed") throw new Error(batch.error)
      expect(batch?.status).toBe("ready")
    })
    const ready = manager.get("test-user-id", created.id)!
    const question = ready.batches[0]?.questions[0]
    if (!question || !ready.currentBatchId) throw new Error("Expected a ready batch")
    const batchId = ready.currentBatchId
    const selected = question.candidates[1]
    if (!selected) throw new Error("Expected multiple candidates")
    const answers = [{ questionId: question.id, selectedCandidateIds: [selected.id], text: "Prioritize cost" }]
    const drafted = manager.saveDraft("test-user-id", created.id, batchId, answers)
    expect(drafted.draftAnswers).toEqual(answers)
    expect(manager.get("other-user-id", created.id)).toBeUndefined()

    const next = manager.askMore("test-user-id", created.id, batchId, answers)
    expect(next.batches[0]).toMatchObject({ status: "submitted", answers: [{ text: "Prioritize cost", unanswered: false }] })
    expect(next.batches).toHaveLength(2)
    await vi.waitFor(() => expect(manager.get("test-user-id", created.id)?.batches[1]?.status).toBe("ready"))
    expect(() => manager.saveDraft("test-user-id", created.id, batchId, answers)).toThrow()
    expect(manager.askMore("test-user-id", created.id, batchId, answers).batches).toHaveLength(2)
  })

  it("hands off one linked final search and makes the session read-only", async () => {
    const manager = createRefineSessionManager(fakeDeepSearchManager())
    const created = manager.create("test-user-id", "Research sustainable travel")
    await vi.waitFor(() => {
      const batch = manager.get("test-user-id", created.id)?.batches[0]
      if (batch?.status === "failed") throw new Error(batch.error)
      expect(batch?.status).toBe("ready")
    })
    const ready = manager.get("test-user-id", created.id)!
    const question = ready.batches[0]?.questions[0]
    if (!question || !ready.currentBatchId) throw new Error("Expected a ready batch")
    const batchId = ready.currentBatchId
    const snapshot = await manager.startResearch("test-user-id", created.id, batchId, [{
      questionId: question.id,
      selectedCandidateIds: [],
      text: "",
    }])
    expect(snapshot.status).toBe("research-started")
    expect(snapshot.research?.deepSearchJobId).toBeDefined()
    expect(snapshot.batches[0]?.answers?.[0]?.unanswered).toBe(true)
    expect(db.select().from(refineSearchLinks).where(and(eq(refineSearchLinks.refineSessionId, created.id), eq(refineSearchLinks.role, "research"))).all()).toHaveLength(1)
    expect(() => manager.saveDraft("test-user-id", created.id, batchId, [])).toThrow()
  })

  it("finalizes a newly active batch when Start races with Ask more using the submitted batch ID", async () => {
    const manager = createRefineSessionManager(fakeDeepSearchManager())
    const created = manager.create("test-user-id", "Research sustainable travel")
    await vi.waitFor(() => expect(manager.get("test-user-id", created.id)?.batches[0]?.status).toBe("ready"))
    const first = manager.get("test-user-id", created.id)!
    const firstBatchId = first.currentBatchId
    const firstQuestion = first.batches[0]?.questions[0]
    if (!firstBatchId || !firstQuestion) throw new Error("Expected a ready initial batch")
    const firstAnswers = [{ questionId: firstQuestion.id, selectedCandidateIds: [], text: "", unanswered: true }]

    mocks.prepareQuestionBatch.mockImplementationOnce((_input: { workflowSignal: AbortSignal }) => new Promise((_resolve, reject) => {
      _input.workflowSignal.addEventListener("abort", () => reject(new Error("Preparation cancelled")), { once: true })
    }))
    const askMoreSnapshot = manager.askMore("test-user-id", created.id, firstBatchId, firstAnswers)
    const pendingBatchId = askMoreSnapshot.pendingBatchId
    if (!pendingBatchId) throw new Error("Expected the next batch to be preparing")
    await vi.waitFor(() => expect(mocks.prepareQuestionBatch).toHaveBeenCalledTimes(2))

    const started = await manager.startResearch("test-user-id", created.id, firstBatchId, firstAnswers)
    expect(started.status).toBe("research-started")
    expect(started.pendingBatchId).toBeNull()
    expect(started.batches.map(({ status }) => status)).toEqual(["submitted", "submitted"])
    expect(started.research?.deepSearchJobId).toBeDefined()
    const finalJob = db.select().from(deepSearchJobs).where(eq(deepSearchJobs.deepSearchJobId, started.research!.deepSearchJobId)).get()
    expect(finalJob?.researchRequest).toContain("Batch unanswered: preparation was cancelled before any questions were presented.")
    expect(db.select().from(refineSearchLinks).where(and(eq(refineSearchLinks.refineSessionId, created.id), eq(refineSearchLinks.role, "research"))).all()).toHaveLength(1)
  })

  it("condenses a maximum-length original request before preparation and final research", async () => {
    const manager = createRefineSessionManager(fakeDeepSearchManager())
    const originalPrompt = `Investigate every constraint. ${"x".repeat(10_000 - "Investigate every constraint. ".length)}`
    mockCondensation(() => ({ researchRequest: "Bounded request retaining every user constraint." }))

    const created = manager.create("test-user-id", originalPrompt)
    await vi.waitFor(() => expect(manager.get("test-user-id", created.id)?.batches[0]?.status).toBe("ready"))
    const ready = manager.get("test-user-id", created.id)!
    const started = await manager.startResearch("test-user-id", created.id, ready.currentBatchId!, [])

    expect(started.status).toBe("research-started")
    expect(mocks.generateObjectStream.mock.calls.length).toBeGreaterThanOrEqual(2)
    expect(mocks.generateObjectStream.mock.calls.every(([input]) => (input as CondenseInput).promptName === PromptName.RefineCondenseResearchRequest)).toBe(true)
    expect(mocks.generateObjectStream.mock.calls.some(([input]) => (input as { prompt: string }).prompt.includes(originalPrompt))).toBe(true)
    const finalJob = db.select().from(deepSearchJobs).where(eq(deepSearchJobs.deepSearchJobId, started.research!.deepSearchJobId)).get()
    expect(finalJob?.researchRequest).toBe("Bounded request retaining every user constraint.")
    expect(finalJob?.researchRequest.length).toBeLessThanOrEqual(config.deepSearch.maxRequestChars)
  })

  it("preserves a long submitted answer as source for the bounded handoff", async () => {
    const manager = createRefineSessionManager(fakeDeepSearchManager())
    mockCondensation((input) => ({ researchRequest: input.prompt.includes("Detailed user answer")
      ? "Bounded final request preserving the detailed answer."
      : "Bounded preparation request." }))
    const created = manager.create("test-user-id", "Research a suitable approach")
    await vi.waitFor(() => expect(manager.get("test-user-id", created.id)?.batches[0]?.status).toBe("ready"))
    const ready = manager.get("test-user-id", created.id)!
    const firstQuestion = ready.batches[0]?.questions[0]
    if (!ready.currentBatchId || !firstQuestion) throw new Error("Expected a ready initial question")
    const longAnswer = `Detailed user answer: ${"specific requirement ".repeat(500)}`.slice(0, 10_000)
    const answers = [{ questionId: firstQuestion.id, selectedCandidateIds: [], text: longAnswer }]

    const next = manager.askMore("test-user-id", created.id, ready.currentBatchId, answers)
    await vi.waitFor(() => expect(manager.get("test-user-id", created.id)?.batches[1]?.status).toBe("ready"))
    const active = manager.get("test-user-id", created.id)!
    const started = await manager.startResearch("test-user-id", created.id, active.currentBatchId!, [])

    expect(started.batches[0]?.answers?.[0]).toMatchObject({ text: longAnswer, unanswered: false })
    expect(next.batches[0]?.status).toBe("submitted")
    expect(mocks.generateObjectStream.mock.calls.some(([input]) => (input as { prompt: string }).prompt.includes(longAnswer))).toBe(true)
    const finalJob = db.select().from(deepSearchJobs).where(eq(deepSearchJobs.deepSearchJobId, started.research!.deepSearchJobId)).get()
    expect(finalJob?.researchRequest).toBe("Bounded final request preserving the detailed answer.")
  })

  it("keeps immutable answers available for Start retry after final condensation fails validation", async () => {
    const manager = createRefineSessionManager(fakeDeepSearchManager())
    const originalPrompt = `Research a suitable approach ${"x".repeat(10_000 - "Research a suitable approach ".length)}`
    mockCondensation(() => ({ researchRequest: "Bounded preparation request." }))
    const created = manager.create("test-user-id", originalPrompt)
    await vi.waitFor(() => expect(manager.get("test-user-id", created.id)?.batches[0]?.status).toBe("ready"))
    const ready = manager.get("test-user-id", created.id)!
    const question = ready.batches[0]?.questions[0]
    if (!ready.currentBatchId || !question) throw new Error("Expected a ready initial question")
    const answer = [{ questionId: question.id, selectedCandidateIds: [], text: "Use the north-facing site." }]
    const oversized = "x".repeat(config.deepSearch.maxRequestChars + 1)
    mockCondensation(() => ({ researchRequest: oversized }))

    await expect(manager.startResearch("test-user-id", created.id, ready.currentBatchId, answer)).rejects.toThrow()
    const failed = manager.get("test-user-id", created.id)!
    expect(failed.status).toBe("clarifying")
    expect(failed.batches[0]).toMatchObject({ status: "submitted", answers: [{ text: "Use the north-facing site." }] })
    expect(failed.research).toBeNull()
    expect(db.select().from(refineSearchLinks).where(and(eq(refineSearchLinks.refineSessionId, created.id), eq(refineSearchLinks.role, "research"))).all()).toHaveLength(0)

    mockCondensation(() => ({ researchRequest: "Bounded retry request." }))
    const retried = await manager.startResearch("test-user-id", created.id, failed.batches[0].id, answer)
    expect(retried.status).toBe("research-started")
    expect(retried.batches[0]?.answers?.[0]?.text).toBe("Use the north-facing site.")
  })

  it("reuses a completed condensation when deep-search startup fails before linking", async () => {
    let failFirstResearchStart = true
    const researchRequests: string[] = []
    const manager = createRefineSessionManager(fakeDeepSearchManager((role, researchRequest) => {
      if (role !== "research") return
      researchRequests.push(researchRequest)
      if (failFirstResearchStart) {
        failFirstResearchStart = false
        throw new Error("Simulated deep-search preflight failure")
      }
    }))
    const originalPrompt = `Retain the last explicit condition. ${"x".repeat(10_000 - "Retain the last explicit condition. ".length)}`
    mockCondensation(() => ({ researchRequest: "Bounded request with all explicit conditions." }))
    const created = manager.create("test-user-id", originalPrompt)
    await vi.waitFor(() => expect(manager.get("test-user-id", created.id)?.batches[0]?.status).toBe("ready"))
    const ready = manager.get("test-user-id", created.id)!
    const batchId = ready.currentBatchId!
    const answer: RefineAnswerInput[] = []

    await expect(manager.startResearch("test-user-id", created.id, batchId, answer)).rejects.toThrow("Simulated deep-search preflight failure")
    const callsAfterFailure = mocks.generateObjectStream.mock.calls.length
    expect(callsAfterFailure).toBeGreaterThan(0)
    expect(manager.get("test-user-id", created.id)?.status).toBe("clarifying")

    const retried = await manager.startResearch("test-user-id", created.id, batchId, answer)

    expect(retried.status).toBe("research-started")
    expect(mocks.generateObjectStream.mock.calls).toHaveLength(callsAfterFailure)
    expect(researchRequests).toEqual([
      "Bounded request with all explicit conditions.",
      "Bounded request with all explicit conditions.",
    ])
    expect(retried.research?.deepSearchJobId).toBeDefined()
    expect(db.select().from(refineSearchLinks).where(and(eq(refineSearchLinks.refineSessionId, created.id), eq(refineSearchLinks.role, "research"))).all()).toHaveLength(1)
  })

  it("bounds each condensation input while carrying late answers into the final request", async () => {
    const manager = createRefineSessionManager(fakeDeepSearchManager())
    mockCondensation(() => ({ researchRequest: "Bounded request includes the late constraint and unanswered status." }))
    const created = manager.create("test-user-id", "Research a suitable approach")
    await vi.waitFor(() => expect(manager.get("test-user-id", created.id)?.batches[0]?.status).toBe("ready"))

    for (let batchIndex = 0; batchIndex < 11; batchIndex += 1) {
      const current = manager.get("test-user-id", created.id)!
      const question = current.batches.at(-1)?.questions[0]
      if (!current.currentBatchId || !question) throw new Error("Expected a ready clarification batch")
      const marker = batchIndex === 10 ? "LATE-CONSTRAINT-FROM-BATCH-11" : `ANSWER-MARKER-${batchIndex + 1}`
      const text = `${marker} ${"preserve this user requirement ".repeat(500)}`.slice(0, 10_000)
      manager.askMore("test-user-id", created.id, current.currentBatchId, [{
        questionId: question.id,
        selectedCandidateIds: [],
        text,
      }])
      await vi.waitFor(() => expect(manager.get("test-user-id", created.id)?.batches.at(-1)?.status).toBe("ready"))
    }

    const current = manager.get("test-user-id", created.id)!
    const started = await manager.startResearch("test-user-id", created.id, current.currentBatchId!, [])
    const condenserCalls = mocks.generateObjectStream.mock.calls.map(([input]) => input as { prompt: string })
    const allCondenserContext = condenserCalls.map(({ prompt }) => prompt).join("\n")

    expect(condenserCalls.length).toBeGreaterThan(1)
    expect(condenserCalls.every(({ prompt }) => prompt.length <= config.deepSearch.maxSummaryContextChars)).toBe(true)
    expect(allCondenserContext).toContain("LATE-CONSTRAINT-FROM-BATCH-11")
    expect(allCondenserContext).toContain("UNANSWERED")
    const finalJob = db.select().from(deepSearchJobs).where(eq(deepSearchJobs.deepSearchJobId, started.research!.deepSearchJobId)).get()
    expect(finalJob?.researchRequest).toBe("Bounded request includes the late constraint and unanswered status.")
  })
})
