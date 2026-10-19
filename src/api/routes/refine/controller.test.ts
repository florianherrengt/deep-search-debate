import { beforeEach, describe, expect, it, vi } from "vitest"

const mocks = vi.hoisted(() => ({ generateObjectStream: vi.fn() }))
vi.mock("../../llms/generateText.ts", () => ({ generateObjectStream: mocks.generateObjectStream }))
vi.mock("../../llms/streams.ts", () => ({
  awaitGenerationOutput: async (_generation: unknown, output: Promise<unknown>) => output,
}))

import { PromptName } from "../../llms/prompts.ts"
import { emptyRefineState, prepareQuestionBatch, recoverUserContext } from "./controller.ts"
import type { RefineSharedState } from "./schemas.ts"

const request = "Help me choose an approach"
const initialState = emptyRefineState()

function modelOutput(promptName: PromptName, knownNeedKeys: string[] = []) {
  switch (promptName) {
    case PromptName.RefineRecoverContext:
      return { requirements: [], knownFacts: [], unresolved: ["selection criteria"] }
    case PromptName.RefineIntegrateAnswers:
      return { resolvedNeedKeys: [], unresolvedNeedKeys: knownNeedKeys, invalidatedNeedKeys: [], assumptionUpdates: [], requirementUpdates: [], followUpWork: [] }
    case PromptName.RefineResearchDomain:
      return { domainMap: [{ key: "approach|constraints|performance|current", text: "Evidence on performance", decisionKeys: ["approach-choice"], sourceRefs: ["measured performance"] }], needs: [] }
    case PromptName.RefineReviewAssumptions:
      return { assumptions: [], needs: [] }
    case PromptName.RefineMapDecisions:
      return {
        decisions: [{ key: "approach-choice", text: "Choose an approach", alternatives: ["A", "B"], sourceRefs: [] }],
        needs: [{ key: "choose|approach|priority|project", text: "Which outcome matters most?", route: "clarification", decisionKeys: ["approach-choice"], sourceRefs: [] }],
        assumptions: [],
      }
    case PromptName.RefineGenerateQuestions:
      return { questions: [{
        question: "Which outcome matters most?", candidates: [
          { label: "Speed", action: "Optimize for speed", consequence: "Lower latency" },
          { label: "Cost", action: "Optimize for cost", consequence: "Lower operating cost" },
        ], needKeys: ["choose|approach|priority|project"], decisionKeys: ["approach-choice"], evidenceRefs: [],
        known: "The choice has speed and cost tradeoffs", missing: "Your priority", consequenceIfUnanswered: "The tradeoff remains unspecified",
      }] }
    case PromptName.RefineReviewQuestions:
      return { approvedIndexes: [0], rejected: [] }
    case PromptName.RefineChooseAction:
      return { action: "ASK_USER", questionIndexes: [0], toolResearchRequests: [], reason: "The answer changes the choice." }
    case PromptName.RefinePresentQuestion:
      return { questions: ["Which outcome matters most in your choice?"] }
    default:
      throw new Error(`Unexpected prompt: ${promptName}`)
  }
}

describe("Refine controller", () => {
  beforeEach(() => {
    mocks.generateObjectStream.mockReset()
    mocks.generateObjectStream.mockImplementation((input: {
      promptName: PromptName
      prompt: string
      onRegistered?: (id: string, transaction: never) => void
      onCompleted?: (completed: { id: string; output: unknown }, transaction: never) => void
    }) => {
      const existingKeys = input.prompt.match(/choose\|approach\|priority\|project/g) ?? []
      const output = modelOutput(input.promptName, existingKeys)
      const generationId = `generation-${input.promptName}`
      const transaction = {} as never
      input.onRegistered?.(generationId, transaction)
      const completedOutput = (value: unknown) => {
        input.onCompleted?.({ id: generationId, output: value }, transaction)
        return value
      }
      if (input.promptName === PromptName.RefineIntegrateAnswers) {
        return { output: Promise.resolve(modelOutput(input.promptName, ["choose|approach|priority|project"])).then(completedOutput) }
      }
      if (input.promptName === PromptName.RefineResearchDomain) {
        return { output: Promise.resolve({ domainMap: [{ key: "approach|constraints|performance|current", text: "Evidence on performance", decisionKeys: ["approach-choice"], sourceRefs: ["measured performance"] }], needs: [] }).then(completedOutput) }
      }
      return { output: Promise.resolve(output).then(completedOutput) }
    })
  })

  it("calls applicable stages and scopes a generated question to its exact need and decision", async () => {
    const checkpoints: Record<string, unknown> = {}
    const registeredStages: string[] = []
    const completedStages: string[] = []
    const result = await prepareQuestionBatch({
      userId: "user", originalPrompt: request, priorAnswers: [], researchEvidence: "", state: initialState,
      checkpoints, saveCheckpoint: (stage, value) => { checkpoints[stage] = value },
      onStageRegistered: (stage) => registeredStages.push(stage),
      onStageCompleted: (stage) => completedStages.push(stage),
    }, true)

    expect(result.questions).toHaveLength(1)
    expect(result.questions[0]).toMatchObject({ needIds: [result.state.needs[0]?.id], decisionIds: [result.state.decisions[0]?.id] })
    expect(result.questions[0]?.candidates.map(({ label }) => label)).toEqual([
      "Speed — Optimize for speed. Consequence: Lower latency",
      "Cost — Optimize for cost. Consequence: Lower operating cost",
    ])
    expect(registeredStages).toEqual(completedStages)
    expect(registeredStages).toContain("recover-context")
    expect(result.state.needs).toHaveLength(1)
    expect(result.state.needs[0]?.key).toBe("choose|approach|priority|project")
    expect(mocks.generateObjectStream.mock.calls.map(([input]) => (input as { promptName: PromptName }).promptName)).toEqual([
      PromptName.RefineRecoverContext, PromptName.RefineReviewAssumptions, PromptName.RefineMapDecisions,
      PromptName.RefineGenerateQuestions, PromptName.RefineReviewQuestions, PromptName.RefineChooseAction,
      PromptName.RefinePresentQuestion,
    ])
  })

  it("does not checkpoint a recovery output whose evidence reference is unsupported", async () => {
    const completedStages: string[] = []
    mocks.generateObjectStream.mockImplementation((input: {
      promptName: PromptName
      onRegistered?: (id: string, transaction: never) => void
      onCompleted?: (completed: { id: string; output: unknown }, transaction: never) => void
    }) => {
      const generationId = `generation-${input.promptName}`
      const transaction = {} as never
      input.onRegistered?.(generationId, transaction)
      const output = input.promptName === PromptName.RefineRecoverContext
        ? { requirements: [{ key: "request|choice|criteria|project", text: "The requirement label", status: "confirmed", affectsDecisionKeys: [], sourceRefs: ["requirement label"] }], knownFacts: [], unresolved: [] }
        : modelOutput(input.promptName)
      return { output: Promise.resolve(output).then((value) => {
        input.onCompleted?.({ id: generationId, output: value }, transaction)
        return value
      }) }
    })
    const checkpoints: Record<string, unknown> = {}
    await expect(prepareQuestionBatch({
      userId: "user", originalPrompt: request, priorAnswers: [], researchEvidence: "", state: initialState, checkpoints,
      saveCheckpoint: (stage, value) => { checkpoints[stage] = value }, onStageRegistered: () => {},
      onStageCompleted: (stage) => { completedStages.push(stage) },
    }, true)).rejects.toThrow("unsupported evidence")
    expect(completedStages).not.toContain("recover-context")
    expect(checkpoints["recover-context"]).toBeUndefined()
  })

  it("requires evidence for recovered confirmed requirements and known facts, but not unresolved requirements", async () => {
    for (const recovered of [
      { requirements: [{ key: "budget|approach|limit|project", text: "The budget is £100,000", status: "confirmed", affectsDecisionKeys: [], sourceRefs: [] }], knownFacts: [], unresolved: [] },
      { requirements: [], knownFacts: [{ key: "budget|project|amount|current", text: "The budget is £100,000", sourceRefs: [] }], unresolved: [] },
    ]) {
      const checkpoints: Record<string, unknown> = {}
      const completedStages: string[] = []
      mocks.generateObjectStream.mockImplementation((input: {
        promptName: PromptName
        onRegistered?: (id: string, transaction: never) => void
        onCompleted?: (completed: { id: string; output: unknown }, transaction: never) => void
      }) => {
        const generationId = `generation-${input.promptName}`
        const transaction = {} as never
        input.onRegistered?.(generationId, transaction)
        const output = input.promptName === PromptName.RefineRecoverContext ? recovered : modelOutput(input.promptName)
        return { output: Promise.resolve(output).then((value) => {
          input.onCompleted?.({ id: generationId, output: value }, transaction)
          return value
        }) }
      })
      await expect(prepareQuestionBatch({
        userId: "user", originalPrompt: "Choose an approach with a £100,000 budget", priorAnswers: [], researchEvidence: "", state: initialState, checkpoints,
        saveCheckpoint: (stage, value) => { checkpoints[stage] = value }, onStageRegistered: () => {},
        onStageCompleted: (stage) => { completedStages.push(stage) },
      }, true)).rejects.toThrow("required evidence")
      expect(completedStages).not.toContain("recover-context")
      expect(checkpoints["recover-context"]).toBeUndefined()
    }

    mocks.generateObjectStream.mockImplementation((input: { promptName: PromptName }) => ({
      output: Promise.resolve(input.promptName === PromptName.RefineRecoverContext
        ? { requirements: [{ key: "budget|approach|limit|project", text: "The budget remains unknown", status: "unresolved", affectsDecisionKeys: [], sourceRefs: [] }], knownFacts: [], unresolved: [] }
        : modelOutput(input.promptName)),
    }))
    await expect(prepareQuestionBatch({
      userId: "user", originalPrompt: request, priorAnswers: [], researchEvidence: "", state: initialState, checkpoints: {},
      saveCheckpoint: () => {}, onStageRegistered: () => {}, onStageCompleted: () => {},
    }, true)).resolves.toBeDefined()
  })

  it("does not treat an unanswered assistant question as evidence for a confirmed requirement", async () => {
    const checkpoints: Record<string, unknown> = {}
    const completedStages: string[] = []
    mocks.generateObjectStream.mockImplementation((input: {
      promptName: PromptName
      onRegistered?: (id: string, transaction: never) => void
      onCompleted?: (completed: { id: string; output: unknown }, transaction: never) => void
    }) => {
      const generationId = `generation-${input.promptName}`
      const transaction = {} as never
      input.onRegistered?.(generationId, transaction)
      const output = input.promptName === PromptName.RefineRecoverContext
        ? { requirements: [{ key: "budget|approach|limit|project", text: "The user budget is £100,000", status: "confirmed", affectsDecisionKeys: [], sourceRefs: ["£100,000"] }], knownFacts: [], unresolved: [] }
        : input.promptName === PromptName.RefineIntegrateAnswers
          ? { resolvedNeedKeys: [], unresolvedNeedKeys: [], invalidatedNeedKeys: [], assumptionUpdates: [], requirementUpdates: [], followUpWork: [] }
          : modelOutput(input.promptName)
      return { output: Promise.resolve(output).then((value) => {
        input.onCompleted?.({ id: generationId, output: value }, transaction)
        return value
      }) }
    })

    await expect(prepareQuestionBatch({
      userId: "user",
      originalPrompt: request,
      priorAnswers: [{ question: "What is your maximum budget? £100,000?", selectedCandidates: [], supplementaryText: "", unanswered: true }],
      researchEvidence: "",
      state: initialState,
      checkpoints,
      saveCheckpoint: (stage, value) => { checkpoints[stage] = value },
      onStageRegistered: () => {},
      onStageCompleted: (stage) => { completedStages.push(stage) },
    }, true)).rejects.toThrow("unsupported evidence")

    expect(completedStages).not.toContain("recover-context")
    expect(checkpoints["recover-context"]).toBeUndefined()
  })

  it("validates confirmed answer requirements against selected and supplemental user content only", async () => {
    const run = (priorAnswer: { question: string; selectedCandidates: string[]; supplementaryText: string; unanswered: boolean }, sourceRef: string) => {
      const checkpoints: Record<string, unknown> = {}
      const completedStages: string[] = []
      mocks.generateObjectStream.mockImplementation((input: {
        promptName: PromptName
        onRegistered?: (id: string, transaction: never) => void
        onCompleted?: (completed: { id: string; output: unknown }, transaction: never) => void
      }) => {
        const generationId = `generation-${input.promptName}`
        const transaction = {} as never
        input.onRegistered?.(generationId, transaction)
        const output = input.promptName === PromptName.RefineIntegrateAnswers
          ? { resolvedNeedKeys: [], unresolvedNeedKeys: [], invalidatedNeedKeys: [], assumptionUpdates: [], requirementUpdates: [{ key: "budget|approach|limit|project", text: "The selected budget is £100,000", status: "confirmed", affectsDecisionKeys: [], sourceRefs: [sourceRef] }], followUpWork: [] }
          : modelOutput(input.promptName)
        return { output: Promise.resolve(output).then((value) => {
          input.onCompleted?.({ id: generationId, output: value }, transaction)
          return value
        }) }
      })
      const result = prepareQuestionBatch({
        userId: "user",
        originalPrompt: request,
        priorAnswers: [priorAnswer],
        researchEvidence: "",
        state: initialState,
        checkpoints,
        saveCheckpoint: (stage, value) => { checkpoints[stage] = value },
        onStageRegistered: () => {},
        onStageCompleted: (stage) => { completedStages.push(stage) },
      }, true)
      return { result, checkpoints, completedStages }
    }

    const unansweredQuestion = run({
      question: "Should the budget be £100,000?",
      selectedCandidates: [],
      supplementaryText: "",
      unanswered: true,
    }, "£100,000")
    await expect(unansweredQuestion.result).rejects.toThrow("unsupported evidence")
    expect(unansweredQuestion.completedStages).not.toContain("integrate-answers")
    expect(unansweredQuestion.checkpoints["integrate-answers"]).toBeUndefined()

    const selectedCandidate = run({
      question: "Which budget option do you prefer?",
      selectedCandidates: ["£100,000 budget"],
      supplementaryText: "",
      unanswered: false,
    }, "£100,000 budget")
    await expect(selectedCandidate.result).resolves.toMatchObject({
      state: { requirements: [{ text: "The selected budget is £100,000", status: "confirmed", source: "£100,000 budget" }] },
    })
  })

  it("requires an exact evidence reference for every research-domain finding", async () => {
    const checkpoints: Record<string, unknown> = {}
    const completedStages: string[] = []
    mocks.generateObjectStream.mockImplementation((input: {
      promptName: PromptName
      onRegistered?: (id: string, transaction: never) => void
      onCompleted?: (completed: { id: string; output: unknown }, transaction: never) => void
    }) => {
      const generationId = `generation-${input.promptName}`
      const transaction = {} as never
      input.onRegistered?.(generationId, transaction)
      const output = input.promptName === PromptName.RefineResearchDomain
        ? { domainMap: [{ key: "approach|constraints|budget|current", text: "Evidence says £100,000", decisionKeys: [], sourceRefs: [] }], needs: [] }
        : modelOutput(input.promptName)
      return { output: Promise.resolve(output).then((value) => {
        input.onCompleted?.({ id: generationId, output: value }, transaction)
        return value
      }) }
    })
    await expect(prepareQuestionBatch({
      userId: "user", originalPrompt: request, priorAnswers: [], researchEvidence: "The study reports a £100,000 budget.", state: initialState, checkpoints,
      saveCheckpoint: (stage, value) => { checkpoints[stage] = value }, onStageRegistered: () => {},
      onStageCompleted: (stage) => { completedStages.push(stage) },
    }, true)).rejects.toThrow("required evidence")
    expect(completedStages).not.toContain("research-domain")
    expect(checkpoints["research-domain"]).toBeUndefined()
  })

  it("requires evidence for integrated confirmed requirements but allows unresolved ones", async () => {
    const run = (status: "confirmed" | "unresolved") => {
      const checkpoints: Record<string, unknown> = {}
      const completedStages: string[] = []
      mocks.generateObjectStream.mockImplementation((input: {
        promptName: PromptName
        onRegistered?: (id: string, transaction: never) => void
        onCompleted?: (completed: { id: string; output: unknown }, transaction: never) => void
      }) => {
        const generationId = `generation-${input.promptName}`
        const transaction = {} as never
        input.onRegistered?.(generationId, transaction)
        const output = input.promptName === PromptName.RefineIntegrateAnswers
          ? { resolvedNeedKeys: [], unresolvedNeedKeys: [], invalidatedNeedKeys: [], assumptionUpdates: [], requirementUpdates: [{ key: "budget|approach|limit|project", text: "The budget is £100,000", status, affectsDecisionKeys: [], sourceRefs: [] }], followUpWork: [] }
          : input.promptName === PromptName.RefineGenerateQuestions
            ? { questions: [] }
            : input.promptName === PromptName.RefineReviewQuestions
              ? { approvedIndexes: [], rejected: [] }
              : input.promptName === PromptName.RefineChooseAction
                ? { action: "PROCEED", questionIndexes: [], toolResearchRequests: [], reason: "No question is useful." }
                : modelOutput(input.promptName)
        return { output: Promise.resolve(output).then((value) => {
          input.onCompleted?.({ id: generationId, output: value }, transaction)
          return value
        }) }
      })
      const context = {
        userId: "user", originalPrompt: request,
        priorAnswers: [{ question: "What is the budget?", selectedCandidates: [], supplementaryText: "The budget is £100,000", unanswered: false }],
        researchEvidence: "", state: initialState, checkpoints,
        saveCheckpoint: (stage: string, value: unknown) => { checkpoints[stage] = value }, onStageRegistered: () => {},
        onStageCompleted: (stage: string) => { completedStages.push(stage) },
      }
      return { result: prepareQuestionBatch(context, true), checkpoints, completedStages }
    }

    const confirmed = run("confirmed")
    await expect(confirmed.result).rejects.toThrow("required evidence")
    expect(confirmed.completedStages).not.toContain("integrate-answers")
    expect(confirmed.checkpoints["integrate-answers"]).toBeUndefined()

    const unresolved = run("unresolved")
    await expect(unresolved.result).resolves.toBeDefined()
    expect(unresolved.completedStages).toContain("integrate-answers")
  })

  it("regenerates only a cached invalid stage when explicit recovery approves and reuses valid later outputs", async () => {
    const invalidRecovery = { requirements: [{ key: "request|choice|criteria|project", text: "A model label", status: "confirmed", affectsDecisionKeys: [], sourceRefs: ["model label"] }], knownFacts: [], unresolved: [] }
    const checkpoints: Record<string, unknown> = {
      "recover-context": invalidRecovery,
      "review-assumptions": { assumptions: [], needs: [] },
    }
    const context = {
      userId: "user", originalPrompt: request, priorAnswers: [], researchEvidence: "", state: initialState, checkpoints,
      saveCheckpoint: (stage: string, value: unknown) => { checkpoints[stage] = value },
      onStageRegistered: () => {}, onStageCompleted: () => {},
    }
    await expect(prepareQuestionBatch({ ...context, recoverInvalidCheckpoint: () => false }, true)).rejects.toThrow("unsupported evidence")
    expect(mocks.generateObjectStream).not.toHaveBeenCalled()

    const invalidated: string[] = []
    const recovered = await prepareQuestionBatch({
      ...context,
      recoverInvalidCheckpoint: (stage) => {
        invalidated.push(stage)
        delete checkpoints[stage]
        return true
      },
    }, true)
    expect(recovered.questions).toHaveLength(1)
    expect(invalidated).toEqual(["recover-context"])
    const generatedPrompts = mocks.generateObjectStream.mock.calls.map(([input]) => (input as { promptName: PromptName }).promptName)
    expect(generatedPrompts).toContain(PromptName.RefineRecoverContext)
    expect(generatedPrompts).not.toContain(PromptName.RefineReviewAssumptions)
  })

  it("retries a malformed cached action only on explicit recovery and reuses valid earlier stages", async () => {
    const completedStages: string[] = []
    const retryCheckpoints: Record<string, unknown> = {
      "choose-action": { action: "PROCEED", questionIndexes: [0], toolResearchRequests: [], reason: "Stale contradictory target" },
    }
    const context = {
      userId: "user", originalPrompt: request, priorAnswers: [], researchEvidence: "", state: initialState, checkpoints: retryCheckpoints,
      saveCheckpoint: (stage: string, value: unknown) => { retryCheckpoints[stage] = value },
      onStageRegistered: () => {},
      onStageCompleted: (stage: string, _generationId: string, output: unknown) => {
        completedStages.push(stage)
        retryCheckpoints[stage] = output
      },
    }
    await expect(prepareQuestionBatch(context, true)).rejects.toThrow()
    expect(completedStages).not.toContain("choose-action")
    const firstAttemptStages = mocks.generateObjectStream.mock.calls.map(([input]) => (input as { promptName: PromptName }).promptName)
    expect(firstAttemptStages).not.toContain(PromptName.RefineChooseAction)

    const invalidatedStages: string[] = []
    const retried = await prepareQuestionBatch({
      ...context,
      recoverInvalidCheckpoint: (stage) => {
        invalidatedStages.push(stage)
        delete retryCheckpoints[stage]
        return true
      },
    }, true)
    expect(invalidatedStages).toEqual(["choose-action"])
    expect(completedStages).toContain("choose-action")
    const retryStages = mocks.generateObjectStream.mock.calls.slice(firstAttemptStages.length).map(([input]) => (input as { promptName: PromptName }).promptName)
    expect(retryStages).toEqual([PromptName.RefineChooseAction, PromptName.RefinePresentQuestion])
    expect(retried.action).toBe("ASK_USER")
    expect(retried.questions).toHaveLength(1)
    expect(retryCheckpoints["choose-action"]).toMatchObject({ action: "ASK_USER" })
  })

  it("validates generated question evidence before checkpoint completion", async () => {
    const completedStages: string[] = []
    mocks.generateObjectStream.mockImplementation((input: {
      promptName: PromptName
      onRegistered?: (id: string, transaction: never) => void
      onCompleted?: (completed: { id: string; output: unknown }, transaction: never) => void
    }) => {
      const generationId = `generation-${input.promptName}`
      const transaction = {} as never
      input.onRegistered?.(generationId, transaction)
      const output = input.promptName === PromptName.RefineGenerateQuestions
        ? { questions: [{
          question: "Which outcome matters most?", candidates: [{ label: "Speed", action: "Optimize for speed", consequence: "Lower latency" }],
          needKeys: ["choose|approach|priority|project"], decisionKeys: ["approach-choice"], evidenceRefs: ["Speed"],
          known: "Known", missing: "Missing", consequenceIfUnanswered: "Unclear",
        }] }
        : modelOutput(input.promptName)
      return { output: Promise.resolve(output).then((value) => {
        input.onCompleted?.({ id: generationId, output: value }, transaction)
        return value
      }) }
    })
    const checkpoints: Record<string, unknown> = {}
    await expect(prepareQuestionBatch({
      userId: "user", originalPrompt: request, priorAnswers: [], researchEvidence: "", state: initialState, checkpoints,
      saveCheckpoint: (stage, value) => { checkpoints[stage] = value }, onStageRegistered: () => {},
      onStageCompleted: (stage) => { completedStages.push(stage) },
    }, true)).rejects.toThrow("unsupported evidence")
    expect(completedStages).not.toContain("generate-questions")
    expect(checkpoints["generate-questions"]).toBeUndefined()
  })

  it("preserves resolved identities while integrating answers and using newly returned research evidence", async () => {
    const needId = "need-stable"
    const decisionId = "decision-stable"
    const state: RefineSharedState = {
      ...initialState,
      decisions: [{ id: decisionId, key: "approach-choice", text: "Choose an approach", alternatives: ["A", "B"], source: "", status: "resolved", version: 4 }],
      needs: [{ id: needId, key: "choose|approach|priority|project", text: "Which priority?", route: "clarification", status: "open", source: "", evidenceIds: [], decisionKeys: ["approach-choice"], decisionIds: [decisionId], version: 2 }],
      questions: [{ questionId: "question-one", needIds: [needId], decisionIds: [decisionId], status: "answered", source: "test", version: 1 }],
    }
    const checkpoints: Record<string, unknown> = {}
    const result = await prepareQuestionBatch({
      userId: "user", originalPrompt: request, priorAnswers: [{ question: "Which priority?", selectedCandidates: ["Speed"], supplementaryText: "", unanswered: false }],
      researchEvidence: "https://example.test/source confirms measured performance.", state, checkpoints,
      saveCheckpoint: (stage, value) => { checkpoints[stage] = value }, onStageRegistered: () => {}, onStageCompleted: () => {},
    }, true)

    expect(result.state.decisions[0]).toMatchObject({ id: decisionId, status: "resolved", version: 4 })
    expect(result.state.needs[0]).toMatchObject({ id: needId, status: "open" })
    expect(result.state.domainMap[0]?.key).toBe("approach|constraints|performance|current")
    const prompts = mocks.generateObjectStream.mock.calls.map(([input]) => (input as { promptName: PromptName }).promptName)
    expect(prompts).toContain(PromptName.RefineIntegrateAnswers)
    expect(prompts).toContain(PromptName.RefineResearchDomain)
  })

  it("rejects model-created references to needs outside the current open set", async () => {
    mocks.generateObjectStream.mockImplementation((input: { promptName: PromptName }) => ({
      output: Promise.resolve(input.promptName === PromptName.RefineGenerateQuestions
        ? { questions: [{ question: "Bad?", candidates: [{ label: "A", action: "A", consequence: "A" }], needKeys: ["made-up"], decisionKeys: ["approach-choice"], evidenceRefs: [], known: "known", missing: "missing", consequenceIfUnanswered: "consequence" }] }
        : modelOutput(input.promptName)),
    }))
    const checkpoints: Record<string, unknown> = {}
    await expect(prepareQuestionBatch({
      userId: "user", originalPrompt: request, priorAnswers: [], researchEvidence: "", state: initialState,
      checkpoints, saveCheckpoint: (stage, value) => { checkpoints[stage] = value }, onStageRegistered: () => {}, onStageCompleted: () => {},
    }, true)).rejects.toThrow(/duplicate, non-open, or unknown need/)
  })

  it("keeps one shared need when the mapping and independent review return the same canonical key", async () => {
    mocks.generateObjectStream.mockImplementation((input: { promptName: PromptName }) => ({
      output: Promise.resolve(input.promptName === PromptName.RefineReviewAssumptions
        ? { assumptions: [], needs: [{ key: "choose|approach|priority|project", text: "Which outcome matters most?", route: "clarification", status: "open", decisionKeys: [], sourceRefs: [] }] }
        : input.promptName === PromptName.RefineGenerateQuestions
          ? { questions: [] }
          : input.promptName === PromptName.RefineReviewQuestions
            ? { approvedIndexes: [], rejected: [] }
            : input.promptName === PromptName.RefineChooseAction
              ? { action: "PROCEED", questionIndexes: [], toolResearchRequests: [], reason: "No question is useful." }
        : modelOutput(input.promptName)),
    }))
    const checkpoints: Record<string, unknown> = {}
    const result = await prepareQuestionBatch({
      userId: "user", originalPrompt: request, priorAnswers: [], researchEvidence: "", state: initialState,
      checkpoints, saveCheckpoint: (stage, value) => { checkpoints[stage] = value }, onStageRegistered: () => {}, onStageCompleted: () => {},
    }, true)
    expect(result.state.needs.filter(({ key }) => key === "choose|approach|priority|project")).toHaveLength(1)
  })

  it("rejects unsupported decision-key references instead of silently dropping them", async () => {
    mocks.generateObjectStream.mockImplementation((input: { promptName: PromptName }) => ({
      output: Promise.resolve(input.promptName === PromptName.RefineRecoverContext
        ? { requirements: [{ key: "spend|approach|budget|project", text: "Budget must remain below a limit", status: "confirmed", affectsDecisionKeys: ["missing-decision"], sourceRefs: ["budget under $500"] }], knownFacts: [], unresolved: [] }
        : modelOutput(input.promptName)),
    }))
    const checkpoints: Record<string, unknown> = {}
    const completedStages: string[] = []
    await expect(prepareQuestionBatch({
      userId: "user", originalPrompt: "Choose an approach with a budget under $500", priorAnswers: [], researchEvidence: "", state: initialState,
      checkpoints, saveCheckpoint: (stage, value) => { checkpoints[stage] = value }, onStageRegistered: () => {}, onStageCompleted: (stage) => { completedStages.push(stage) },
    }, true)).rejects.toThrow("unknown decision key")
    expect(completedStages).not.toContain("map-decisions")
    expect(checkpoints["map-decisions"]).toBeUndefined()
  })

  it("accepts prospective recovery and domain decision references when the later map defines them", async () => {
    const prospectiveKey = "approach-choice"
    mocks.generateObjectStream.mockImplementation((input: {
      promptName: PromptName
      onRegistered?: (id: string, transaction: never) => void
      onCompleted?: (completed: { id: string; output: unknown }, transaction: never) => void
    }) => {
      const generationId = `generation-${input.promptName}`
      const transaction = {} as never
      input.onRegistered?.(generationId, transaction)
      let output: unknown = modelOutput(input.promptName)
      if (input.promptName === PromptName.RefineRecoverContext) output = {
        requirements: [{ key: "budget|approach|limit|project", text: "Budget must stay below $500", status: "confirmed", affectsDecisionKeys: [prospectiveKey], sourceRefs: ["budget under $500"] }],
        knownFacts: [], unresolved: [],
      }
      if (input.promptName === PromptName.RefineResearchDomain) output = {
        domainMap: [{ key: "approach|constraints|throughput|current", text: "The benchmark reports measured throughput.", decisionKeys: [prospectiveKey], sourceRefs: ["measured throughput"] }],
        needs: [],
      }
      return { output: Promise.resolve(output).then((value) => {
        input.onCompleted?.({ id: generationId, output: value }, transaction)
        return value
      }) }
    })
    const checkpoints: Record<string, unknown> = {}
    const result = await prepareQuestionBatch({
      userId: "user", originalPrompt: "Choose an approach with a budget under $500", priorAnswers: [],
      researchEvidence: "The latest source reports measured throughput for the approach.", state: initialState, checkpoints,
      saveCheckpoint: (stage, value) => { checkpoints[stage] = value }, onStageRegistered: () => {}, onStageCompleted: () => {},
    }, true)
    expect(result.state.decisions.some(({ key }) => key === prospectiveKey)).toBe(true)
    expect(result.state.requirements[0]?.affectsDecisionKeys).toEqual([prospectiveKey])
    expect(result.state.requirements[0]?.affectsDecisionIds).toEqual([result.state.decisions.find(({ key }) => key === prospectiveKey)?.id])
    expect(result.state.domainMap[0]?.decisionKeys).toEqual([prospectiveKey])
  })

  it("accepts prospective integration and assumption-review keys when the later map defines them", async () => {
    const prospectiveKey = "approach-choice"
    const needId = "b80fa0d5-7cd3-4f17-a795-f53854c57d35"
    const needKey = "choose|approach|priority|project"
    mocks.generateObjectStream.mockImplementation((input: { promptName: PromptName }) => {
      let output: unknown = modelOutput(input.promptName, [needKey])
      if (input.promptName === PromptName.RefineIntegrateAnswers) output = {
        resolvedNeedKeys: [], unresolvedNeedKeys: [needKey], invalidatedNeedKeys: [], assumptionUpdates: [],
        requirementUpdates: [{ key: "budget|approach|limit|project", text: "Budget must stay below $500", status: "confirmed", affectsDecisionKeys: [prospectiveKey], sourceRefs: ["budget under $500"] }],
        followUpWork: [],
      }
      if (input.promptName === PromptName.RefineReviewAssumptions) output = {
        assumptions: [{ key: "benchmark|approach|availability|current", text: "A benchmark is available", consequence: "Can compare approaches", decisionKeys: [prospectiveKey], status: "active", sourceRefs: ["budget under $500"] }],
        needs: [{ key: needKey, text: "Which outcome matters?", route: "clarification", status: "open", decisionKeys: [prospectiveKey], sourceRefs: ["budget under $500"] }],
      }
      return { output: Promise.resolve(output) }
    })
    const checkpoints: Record<string, unknown> = {}
    const state: RefineSharedState = {
      ...initialState,
      needs: [{ id: needId, key: needKey, text: "Which outcome matters?", route: "clarification", status: "open", source: "", evidenceIds: [], decisionKeys: [], decisionIds: [], version: 1 }],
    }
    const result = await prepareQuestionBatch({
      userId: "user", originalPrompt: "Choose an approach", priorAnswers: [{ question: "Budget?", selectedCandidates: [], supplementaryText: "budget under $500", unanswered: false }],
      researchEvidence: "", state, checkpoints, saveCheckpoint: (stage, value) => { checkpoints[stage] = value }, onStageRegistered: () => {}, onStageCompleted: () => {},
    }, true)
    expect(result.state.decisions.some(({ key }) => key === prospectiveKey)).toBe(true)
    expect(result.state.requirements[0]?.affectsDecisionKeys).toEqual([prospectiveKey])
    expect(result.state.assumptions[0]?.decisionKeys).toEqual([prospectiveKey])
    expect(result.state.needs.find(({ id }) => id === needId)?.decisionKeys).toEqual([prospectiveKey])
  })

  it("rejects a question that cites a real decision outside its linked need", async () => {
    mocks.generateObjectStream.mockImplementation((input: { promptName: PromptName }) => ({
      output: Promise.resolve(input.promptName === PromptName.RefineMapDecisions
        ? {
          decisions: [
            { key: "approach-choice", text: "Choose an approach", alternatives: ["A"], sourceRefs: [] },
            { key: "supplier-choice", text: "Choose a supplier", alternatives: ["X"], sourceRefs: [] },
          ],
          needs: [{ key: "choose|approach|priority|project", text: "Which outcome matters?", route: "clarification", decisionKeys: ["approach-choice"], sourceRefs: [] }],
          assumptions: [],
        }
        : input.promptName === PromptName.RefineGenerateQuestions
          ? { questions: [{
            question: "Which outcome matters?", candidates: [{ label: "Speed", action: "Optimize for speed", consequence: "Lower latency" }],
            needKeys: ["choose|approach|priority|project"], decisionKeys: ["supplier-choice"], evidenceRefs: [], known: "Known", missing: "Missing", consequenceIfUnanswered: "Unclear",
          }] }
          : modelOutput(input.promptName)),
    }))
    const checkpoints: Record<string, unknown> = {}
    await expect(prepareQuestionBatch({
      userId: "user", originalPrompt: request, priorAnswers: [], researchEvidence: "", state: initialState,
      checkpoints, saveCheckpoint: (stage, value) => { checkpoints[stage] = value }, onStageRegistered: () => {}, onStageCompleted: () => {},
    }, true)).rejects.toThrow("does not belong to its information need")
  })

  it("rejects question review indexes that overlap or leave candidates unclassified", async () => {
    for (const review of [
      { approvedIndexes: [0], rejected: [{ index: 0, reason: "duplicate classification" }] },
      { approvedIndexes: [], rejected: [] },
    ]) {
      mocks.generateObjectStream.mockImplementation((input: { promptName: PromptName }) => ({
        output: Promise.resolve(input.promptName === PromptName.RefineReviewQuestions ? review : modelOutput(input.promptName)),
      }))
      const checkpoints: Record<string, unknown> = {}
      await expect(prepareQuestionBatch({
        userId: "user", originalPrompt: request, priorAnswers: [], researchEvidence: "", state: initialState,
        checkpoints, saveCheckpoint: (stage, value) => { checkpoints[stage] = value }, onStageRegistered: () => {}, onStageCompleted: () => {},
      }, true)).rejects.toThrow("must classify every candidate exactly once")
    }
  })

  it("routes external facts to targeted research using the open research need ID", async () => {
    const researchNeedId = "b80fa0d5-7cd3-4f17-a795-f53854c57d35"
    mocks.generateObjectStream.mockImplementation((input: { promptName: PromptName }) => {
      let output: unknown = modelOutput(input.promptName)
      if (input.promptName === PromptName.RefineMapDecisions) output = {
        decisions: [{ key: "approach-choice", text: "Choose an approach", alternatives: ["A"], sourceRefs: [] }],
        needs: [
          { key: "choose|approach|priority|project", text: "Which outcome matters?", route: "clarification", decisionKeys: ["approach-choice"], sourceRefs: [] },
          { key: "approach|constraints|performance|external", text: "What are measured performance limits?", route: "research", decisionKeys: ["approach-choice"], sourceRefs: [] },
        ], assumptions: [],
      }
      if (input.promptName === PromptName.RefineChooseAction) output = {
        action: "TOOL_WORK", questionIndexes: [], toolResearchRequests: [{ needIds: [researchNeedId], request: "Find independent performance measurements" }], reason: "The fact is externally verifiable.",
      }
      return { output: Promise.resolve(output) }
    })
    const state: RefineSharedState = {
      ...initialState,
      needs: [{ id: researchNeedId, key: "approach|constraints|performance|external", text: "What are measured performance limits?", route: "research", status: "open", source: "", evidenceIds: [], decisionKeys: ["approach-choice"], decisionIds: [], version: 1 }],
    }
    const checkpoints: Record<string, unknown> = {}
    const result = await prepareQuestionBatch({
      userId: "user", originalPrompt: request, priorAnswers: [], researchEvidence: "", state,
      checkpoints, saveCheckpoint: (stage, value) => { checkpoints[stage] = value }, onStageRegistered: () => {}, onStageCompleted: () => {},
    }, true)
    expect(result.action).toBe("TOOL_WORK")
    expect(result.toolResearchRequests).toEqual([{ needIds: [researchNeedId], request: "Find independent performance measurements" }])
  })

  it("integrates one answer without resolving an unrelated or unanswered need", async () => {
    const firstId = "b80fa0d5-7cd3-4f17-a795-f53854c57d35"
    const secondId = "f5cab413-d116-40a0-b8c3-7cf2dd103f94"
    mocks.generateObjectStream.mockImplementation((input: { promptName: PromptName }) => ({
      output: Promise.resolve(input.promptName === PromptName.RefineIntegrateAnswers
        ? { resolvedNeedKeys: ["choose|approach|priority|project"], unresolvedNeedKeys: ["choose|approach|timeline|project"], invalidatedNeedKeys: [], assumptionUpdates: [], requirementUpdates: [], followUpWork: [] }
        : input.promptName === PromptName.RefineGenerateQuestions
          ? { questions: [] }
          : input.promptName === PromptName.RefineReviewQuestions
            ? { approvedIndexes: [], rejected: [] }
            : input.promptName === PromptName.RefineChooseAction
              ? { action: "ASK_USER", questionIndexes: [], toolResearchRequests: [], reason: "The remaining need is unresolved." }
              : input.promptName === PromptName.RefinePresentQuestion
                ? { questions: [] }
        : modelOutput(input.promptName)),
    }))
    const state: RefineSharedState = {
      ...initialState,
      decisions: [{ id: "4ddb41ea-4c98-44e5-80e4-7a1b710be6bc", key: "approach-choice", text: "Choose an approach", alternatives: ["A", "B"], source: "", status: "open", version: 1 }],
      needs: [
        { id: firstId, key: "choose|approach|priority|project", text: "Which outcome?", route: "clarification", status: "open", source: "", evidenceIds: [], decisionKeys: ["approach-choice"], decisionIds: [], version: 1 },
        { id: secondId, key: "choose|approach|timeline|project", text: "When is it needed?", route: "clarification", status: "open", source: "", evidenceIds: [], decisionKeys: ["approach-choice"], decisionIds: [], version: 1 },
      ],
    }
    const checkpoints: Record<string, unknown> = {}
    const result = await prepareQuestionBatch({
      userId: "user", originalPrompt: request, priorAnswers: [
        { question: "Which outcome?", selectedCandidates: ["Speed"], supplementaryText: "", unanswered: false },
        { question: "When is it needed?", selectedCandidates: [], supplementaryText: "", unanswered: true },
      ], researchEvidence: "", state, checkpoints, saveCheckpoint: (stage, value) => { checkpoints[stage] = value }, onStageRegistered: () => {}, onStageCompleted: () => {},
    }, true)
    expect(result.state.needs.find(({ id }) => id === firstId)?.status).toBe("resolved")
    expect(result.state.needs.find(({ id }) => id === secondId)?.status).toBe("open")
  })

  it("routes a follow-up need to research before later stages and keeps the route available for targeted work", async () => {
    const needId = "b80fa0d5-7cd3-4f17-a795-f53854c57d35"
    const needKey = "choose|approach|priority|project"
    const state: RefineSharedState = {
      ...initialState,
      decisions: [{ id: "4ddb41ea-4c98-44e5-80e4-7a1b710be6bc", key: "approach-choice", text: "Choose an approach", alternatives: ["A", "B"], source: "", status: "open", version: 1 }],
      needs: [{ id: needId, key: needKey, text: "Which outcome matters?", route: "clarification", status: "open", source: "", evidenceIds: [], decisionKeys: ["approach-choice"], decisionIds: [], version: 1 }],
    }
    let mapStagePrompt = ""
    mocks.generateObjectStream.mockImplementation((input: { promptName: PromptName; prompt: string }) => {
      let output: unknown = modelOutput(input.promptName, [needKey])
      if (input.promptName === PromptName.RefineIntegrateAnswers) output = {
        resolvedNeedKeys: [], unresolvedNeedKeys: [needKey], invalidatedNeedKeys: [], assumptionUpdates: [], requirementUpdates: [],
        followUpWork: [{ needKey, route: "research", reason: "The preference does not establish measured performance." }],
      }
      if (input.promptName === PromptName.RefineMapDecisions) {
        mapStagePrompt = input.prompt
        output = { decisions: [{ key: "approach-choice", text: "Choose an approach", alternatives: ["A", "B"], sourceRefs: [] }], needs: [], assumptions: [] }
      }
      if (input.promptName === PromptName.RefineGenerateQuestions) output = { questions: [] }
      if (input.promptName === PromptName.RefineReviewQuestions) output = { approvedIndexes: [], rejected: [] }
      if (input.promptName === PromptName.RefineChooseAction) output = {
        action: "TOOL_WORK", questionIndexes: [], toolResearchRequests: [{ needIds: [needId], request: "Find measured performance limits" }], reason: "The requested fact is verifiable.",
      }
      return { output: Promise.resolve(output) }
    })
    const checkpoints: Record<string, unknown> = {}
    const result = await prepareQuestionBatch({
      userId: "user", originalPrompt: request, priorAnswers: [{ question: "Which outcome matters?", selectedCandidates: ["Speed"], supplementaryText: "Need benchmark evidence", unanswered: false }],
      researchEvidence: "", state, checkpoints, saveCheckpoint: (stage, value) => { checkpoints[stage] = value }, onStageRegistered: () => {}, onStageCompleted: () => {},
    }, true)
    expect(mapStagePrompt).toContain('"route":"research"')
    expect(result.state.needs[0]).toMatchObject({ id: needId, route: "research", status: "open", version: 2 })
    expect(result.action).toBe("TOOL_WORK")
    expect(result.toolResearchRequests[0]?.needIds).toEqual([needId])
  })

  it("rejects unknown, duplicate, or status-contradicting follow-up needs", async () => {
    const key = "choose|approach|priority|project"
    const state: RefineSharedState = {
      ...initialState,
      needs: [{ id: "b80fa0d5-7cd3-4f17-a795-f53854c57d35", key, text: "Which outcome?", route: "clarification", status: "open", source: "", evidenceIds: [], decisionKeys: [], decisionIds: [], version: 1 }],
    }
    for (const integration of [
      { resolvedNeedKeys: [], followUpWork: [{ needKey: "missing|entity|attribute|scope", route: "research", reason: "Unknown" }] },
      { resolvedNeedKeys: [], followUpWork: [{ needKey: key, route: "research", reason: "First" }, { needKey: key, route: "defer", reason: "Duplicate" }] },
      { resolvedNeedKeys: [key], unresolvedNeedKeys: [], followUpWork: [{ needKey: key, route: "research", reason: "Contradictory" }] },
    ]) {
      mocks.generateObjectStream.mockImplementation((input: { promptName: PromptName }) => ({
        output: Promise.resolve(input.promptName === PromptName.RefineIntegrateAnswers
          ? { ...modelOutput(input.promptName, [key]), unresolvedNeedKeys: [key], invalidatedNeedKeys: [], assumptionUpdates: [], requirementUpdates: [], ...integration }
          : modelOutput(input.promptName, [key])),
      }))
      const checkpoints: Record<string, unknown> = {}
      await expect(prepareQuestionBatch({
        userId: "user", originalPrompt: request, priorAnswers: [{ question: "Which outcome?", selectedCandidates: ["Speed"], supplementaryText: "", unanswered: false }],
        researchEvidence: "", state, checkpoints, saveCheckpoint: (stage, value) => { checkpoints[stage] = value }, onStageRegistered: () => {}, onStageCompleted: () => {},
      }, true)).rejects.toThrow(/follow-up|contradictory/i)
    }
  })

  it("skips question presentation when the action selects no questions", async () => {
    mocks.generateObjectStream.mockImplementation((input: { promptName: PromptName }) => ({
      output: Promise.resolve(input.promptName === PromptName.RefineChooseAction
        ? { action: "PROCEED", questionIndexes: [], toolResearchRequests: [], reason: "The remaining questions do not help." }
        : input.promptName === PromptName.RefinePresentQuestion
          ? (() => { throw new Error("Presentation must not run for an empty selection") })()
          : modelOutput(input.promptName)),
    }))
    const checkpoints: Record<string, unknown> = {}
    const result = await prepareQuestionBatch({
      userId: "user", originalPrompt: request, priorAnswers: [], researchEvidence: "", state: initialState,
      checkpoints, saveCheckpoint: (stage, value) => { checkpoints[stage] = value }, onStageRegistered: () => {}, onStageCompleted: () => {},
    }, true)
    expect(result.questions).toEqual([])
    expect(result.state.questions).toEqual([])
    expect(mocks.generateObjectStream.mock.calls.map(([input]) => (input as { promptName: PromptName }).promptName)).not.toContain(PromptName.RefinePresentQuestion)
  })

  it("recovers saved answer text with the immutable question and candidate wording", () => {
    const recovered = recoverUserContext("Original", [{
      questions: JSON.stringify([{ id: "00000000-0000-4000-8000-000000000001", prompt: "Which?", candidates: [{ id: "00000000-0000-4000-8000-000000000002", label: "Option one" }] }]),
      answers: JSON.stringify([{ questionId: "00000000-0000-4000-8000-000000000001", selectedCandidateIds: ["00000000-0000-4000-8000-000000000002"], text: "More context", unanswered: false }]),
    }])
    expect(recovered.priorAnswers).toEqual([{ question: "Which?", selectedCandidates: ["Option one"], supplementaryText: "More context", unanswered: false }])
  })
})
