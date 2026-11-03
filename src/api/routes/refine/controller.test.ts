import { beforeEach, describe, expect, it, vi } from "vitest"
import { createHash } from "node:crypto"

const mocks = vi.hoisted(() => ({ generateObjectStream: vi.fn() }))
vi.mock("../../llms/generateText.ts", () => ({ generateObjectStream: mocks.generateObjectStream }))
vi.mock("../../llms/streams.ts", () => ({
  awaitGenerationOutput: async (_generation: unknown, output: Promise<unknown>) => output,
}))

import { PromptName } from "../../llms/prompts.ts"
import { prepareQuestionBatch, recoverUserContext } from "./controller.ts"

const request = "Help me choose an approach"
const selected = "Optimize for speed"
const supplemental = "The launch is in June"
const research = "A measured study found a 14% gain.\n\nA second source found a 9% gain."
const priorAnswers = [
  { question: "Which outcome matters?", selectedCandidates: [selected], supplementaryText: supplemental, unanswered: false },
  { question: "What is your budget?", selectedCandidates: [], supplementaryText: "", unanswered: true },
]

type GenerationInput = {
  userId: string
  promptName: PromptName
  prompt: string
  schema: { parse(value: unknown): unknown }
  workflowSignal?: AbortSignal
  onRegistered?: (id: string, transaction: never) => void
  onCompleted?: (result: { id: string; output: unknown }, transaction: never) => void
}

function evidenceId(kind: string, text: string): string {
  return `evidence_${createHash("sha256").update(kind).update("\0").update(text).digest("hex").slice(0, 32)}`
}

function validOutput(evidenceRefs: string[] = []) {
  return {
    questions: [{
      question: "Which outcome should take priority?",
      candidates: [
        { label: "Speed", action: "Optimize for speed", consequence: "Higher operating cost" },
        { label: "Cost", action: "Optimize for cost", consequence: "Longer delivery time" },
      ],
      evidenceRefs,
    }],
  }
}

function successfulGeneration(output: unknown = validOutput()) {
  mocks.generateObjectStream.mockResolvedValue({ output: Promise.resolve(output) })
}

function createContext(overrides: Record<string, unknown> = {}) {
  const checkpoints: Record<string, unknown> = {}
  const onStageRegistered = vi.fn()
  const onStageCompleted = vi.fn()
  return {
    context: {
      userId: "user",
      originalPrompt: request,
      priorAnswers,
      researchEvidence: research,
      checkpoints,
      onStageRegistered,
      onStageCompleted,
      ...overrides,
    },
    checkpoints,
    onStageRegistered,
    onStageCompleted,
  }
}

describe("Refine question controller", () => {
  beforeEach(() => mocks.generateObjectStream.mockReset())

  it("uses one call with the request, brief, and full prior answers, then registers and checkpoints that generation", async () => {
    successfulGeneration(validOutput([evidenceId("research", "A measured study found a 14% gain.")]))
    const { context, onStageRegistered, onStageCompleted } = createContext()

    const result = await prepareQuestionBatch(context)

    expect(mocks.generateObjectStream).toHaveBeenCalledTimes(1)
    const input = mocks.generateObjectStream.mock.calls[0]?.[0] as GenerationInput
    expect(input.promptName).toBe(PromptName.RefineGenerateQuestions)
    expect(input.prompt).toContain(request)
    expect(input.prompt).toContain(research)
    expect(input.prompt).toContain(JSON.stringify(priorAnswers))
    expect(input.prompt).toContain(selected)
    expect(input.prompt).toContain(supplemental)
    expect(input.prompt).toContain('"unanswered":true')
    expect(result.questions).toHaveLength(1)
    expect(input.workflowSignal).toBeUndefined()
    const transaction = {} as never
    input.onRegistered?.("generation-questions", transaction)
    expect(onStageRegistered).toHaveBeenCalledWith("generate-questions", "generation-questions", transaction)
    const rawOutput = validOutput([evidenceId("research", "A measured study found a 14% gain.")])
    input.onCompleted?.({ id: "generation-questions", output: input.schema.parse(rawOutput) }, transaction)
    expect(onStageCompleted).toHaveBeenCalledWith("generate-questions", "generation-questions", {
      questions: [{ ...rawOutput.questions[0], evidenceRefs: ["A measured study found a 14% gain."] }],
    }, transaction)
  })

  it("validates exact evidence IDs and resolves them to their canonical excerpt text", async () => {
    successfulGeneration(validOutput([evidenceId("research", "A measured study found a 14% gain.")]))
    const { context } = createContext()
    const result = await prepareQuestionBatch(context)

    expect(result.questions[0]?.evidenceRefs).toEqual(["A measured study found a 14% gain."])
  })

  it("rejects unknown and non-exact evidence references before checkpoint completion", async () => {
    for (const reference of ["missing-id", "A measured study found a 14% gain."]) {
      successfulGeneration({
        questions: [{
          question: "Which outcome should take priority?",
          candidates: [{ label: "Speed", action: "Optimize for speed", consequence: "Higher cost" }],
          evidenceRefs: [reference],
        }],
      })
      const { context } = createContext()
      await expect(prepareQuestionBatch(context)).rejects.toThrow()
    }
  })

  it("rejects malformed output, blank question or candidate text, and duplicate question or choice labels", async () => {
    const invalidOutputs: unknown[] = [
      { questions: "not-an-array" },
      { questions: [{ question: "  ", candidates: [{ label: "Speed", action: "Act", consequence: "Result" }], evidenceRefs: [] }] },
      { questions: [{ question: "Choose?", candidates: [{ label: "  ", action: "Act", consequence: "Result" }], evidenceRefs: [] }] },
      { questions: [{ question: "Choose?", candidates: [{ label: "Speed", action: " ", consequence: "Result" }], evidenceRefs: [] }] },
      { questions: [{ question: "Choose?", candidates: [{ label: "Speed", action: "Act", consequence: " " }], evidenceRefs: [] }] },
      { questions: [
        { question: "Choose?", candidates: [{ label: "Speed", action: "Act", consequence: "Result" }], evidenceRefs: [] },
        { question: "Choose?", candidates: [{ label: "Cost", action: "Act", consequence: "Result" }], evidenceRefs: [] },
      ] },
      { questions: [{ question: "Choose?", candidates: [
        { label: "Speed", action: "Act", consequence: "Result" },
        { label: "Speed", action: "Different act", consequence: "Different result" },
      ], evidenceRefs: [] }] },
    ]
    for (const output of invalidOutputs) {
      successfulGeneration(output)
      const { context } = createContext()
      await expect(prepareQuestionBatch(context)).rejects.toThrow()
    }
  })

  it("allows an empty question batch", async () => {
    successfulGeneration({ questions: [] })
    const { context } = createContext()

    await expect(prepareQuestionBatch(context)).resolves.toEqual({ questions: [] })
  })

  it("passes cancellation to the one generation and aborts before starting when already cancelled", async () => {
    successfulGeneration(validOutput())
    const abortController = new AbortController()
    const { context } = createContext({ workflowSignal: abortController.signal })
    await prepareQuestionBatch(context)
    expect((mocks.generateObjectStream.mock.calls[0]?.[0] as GenerationInput).workflowSignal).toBe(abortController.signal)

    const cancelled = new AbortController()
    cancelled.abort(new Error("Preparation cancelled"))
    const cancelledContext = createContext({ workflowSignal: cancelled.signal })
    await expect(prepareQuestionBatch(cancelledContext.context)).rejects.toThrow("Preparation cancelled")
    expect(mocks.generateObjectStream).toHaveBeenCalledTimes(1)
  })

  it("reuses a valid completed checkpoint without another model call", async () => {
    const cached = {
      questions: [{
        question: "Which outcome should take priority?",
        candidates: [{ label: "Speed", action: "Optimize for speed", consequence: "Higher cost" }],
        evidenceRefs: ["A measured study found a 14% gain."],
      }],
    }
    const { context, checkpoints, onStageRegistered, onStageCompleted } = createContext({ checkpoints: { "generate-questions": cached } })
    Object.assign(checkpoints, { "generate-questions": cached })

    await expect(prepareQuestionBatch(context)).resolves.toMatchObject({ questions: [{ prompt: "Which outcome should take priority?" }] })
    expect(mocks.generateObjectStream).not.toHaveBeenCalled()
    expect(onStageRegistered).not.toHaveBeenCalled()
    expect(onStageCompleted).not.toHaveBeenCalled()
  })

  it("strictly revalidates completed checkpoints against the current evidence catalog", async () => {
    const invalid = { questions: [{ question: "Choose?", candidates: [{ label: "Speed", action: "Act", consequence: "Result" }], evidenceRefs: ["not in the catalog"] }] }
    const { context } = createContext({ checkpoints: { "generate-questions": invalid } })
    await expect(prepareQuestionBatch(context)).rejects.toThrow()
    expect(mocks.generateObjectStream).not.toHaveBeenCalled()
  })

  it("recovers saved answer text with the immutable question and candidate wording", () => {
    const recovered = recoverUserContext("Original", [{
      questions: JSON.stringify([{ id: "00000000-0000-4000-8000-000000000001", prompt: "Which?", candidates: [{ id: "00000000-0000-4000-8000-000000000002", label: "Option one" }] }]),
      answers: JSON.stringify([{ questionId: "00000000-0000-4000-8000-000000000001", selectedCandidateIds: ["00000000-0000-4000-8000-000000000002"], text: "More context", unanswered: false }]),
    }])
    expect(recovered.priorAnswers).toEqual([{ question: "Which?", selectedCandidates: ["Option one"], supplementaryText: "More context", unanswered: false }])
  })

  it("rejects malformed saved answers and answers detached from their immutable questions", () => {
    expect(() => recoverUserContext("Original", [{ questions: "[]", answers: "not-json" }])).toThrow()
    expect(() => recoverUserContext("Original", [{
      questions: JSON.stringify([{ id: "00000000-0000-4000-8000-000000000001", prompt: "Which?", candidates: [] }]),
      answers: JSON.stringify([{ questionId: "00000000-0000-4000-8000-000000000003", selectedCandidateIds: [], text: "Detached answer", unanswered: false }]),
    }])).toThrow("missing saved question")
  })
})
