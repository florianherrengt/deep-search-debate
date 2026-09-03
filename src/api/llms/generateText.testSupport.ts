import { vi } from "vitest"
import type {
  LlmModelAssignmentSnapshot,
  LlmReasoningEffort,
} from "./modelSettings.ts"

type MockLlmCall = {
  model: { modelId: string }
  modelId: string
  provider: "server" | "codex"
  supportsStructuredOutputs: boolean
  callOptions: Record<string, unknown>
  wrapStream(source: unknown): unknown
  release(): Promise<void>
}

export const mocks = {
  callOptions: vi.fn((reasoningEffort: LlmReasoningEffort) => ({
    providerOptions: { test: { reasoningEffort } },
  })),
  generateText: vi.fn(),
  loadPrompt: vi.fn(),
  model: vi.fn((model?: string) => ({
    modelId: model ?? "configured-model",
  })),
  outputArray: vi.fn((options: unknown) => ({ type: "array", options })),
  outputObject: vi.fn((options: unknown) => ({ type: "object", options })),
  prepareTextGeneration: vi.fn(),
  release: vi.fn(() => Promise.resolve()),
  reservationRelease: vi.fn(),
  requirePositiveCreditBalance: vi.fn(),
  resolveLlmCall: vi.fn(
    (
      _userId: string,
      snapshot: LlmModelAssignmentSnapshot,
    ): Promise<MockLlmCall> =>
      Promise.resolve(
        serverLlmCall(
          snapshot.assignment.reasoningEffort,
          snapshot.assignment.modelId,
        ),
      ),
  ),
  reserveLlmCall: vi.fn(
    (
      userId: string,
      snapshot: LlmModelAssignmentSnapshot,
      _signal?: AbortSignal,
    ) =>
      Promise.resolve({
        resolve: () => mocks.resolveLlmCall(userId, snapshot),
        release: mocks.reservationRelease,
      }),
  ),
  streamText: vi.fn(),
  wrapStream: vi.fn((source: unknown) => source),
}

vi.mock("ai", () => ({
  generateText: mocks.generateText,
  Output: { array: mocks.outputArray, object: mocks.outputObject },
  streamText: mocks.streamText,
}))

vi.mock("./prompts.ts", () => ({
  PromptName: {
    Default: "default",
    GeneratePromptTitle: "generate-prompt-title",
    GenerateWebSearchQueries: "generate-websearch-queries",
  },
  loadPrompt: mocks.loadPrompt,
}))

vi.mock("../credits.ts", () => ({
  requirePositiveCreditBalance: mocks.requirePositiveCreditBalance,
}))

vi.mock("./streams.ts", () => ({
  awaitGenerationOutput: async (
    generation: { completion: Promise<{ status: string; error?: string }> },
    output: Promise<unknown>,
  ) => {
    const outcome = await generation.completion
    if (outcome.status === "failed") throw new Error(outcome.error)
    return output
  },
  prepareTextGeneration: mocks.prepareTextGeneration,
}))

vi.mock("./provider.ts", () => ({ reserveLlmCall: mocks.reserveLlmCall }))

export function completedGenerationHandle() {
  return {
    id: "stream-id",
    completion: Promise.resolve({
      status: "completed" as const,
      text: "Persisted output",
      reasoning: "Persisted reasoning",
    }),
  }
}

export function serverLlmCall(
  reasoningEffort: LlmReasoningEffort,
  modelId: string,
) {
  const model = mocks.model(modelId)
  return {
    model,
    modelId: model.modelId,
    provider: "server" as "server" | "codex",
    supportsStructuredOutputs: false,
    callOptions: mocks.callOptions(reasoningEffort),
    wrapStream: mocks.wrapStream,
    release: mocks.release,
  }
}

export function subscriptionLlmCall(options?: {
  wrappedStream?: unknown
  release?: () => Promise<void>
}) {
  const wrappedStream = options?.wrappedStream ?? { id: "wrapped-stream" }
  return {
    model: { modelId: "gpt-5.6-sol" },
    modelId: "gpt-5.6-sol",
    provider: "codex" as const,
    supportsStructuredOutputs: true,
    callOptions: {},
    wrapStream: vi.fn(() => wrappedStream),
    release: options?.release ?? vi.fn(() => Promise.resolve()),
  }
}

export function llmReservation<Call>(call: Call) {
  return {
    resolve: vi.fn(() => Promise.resolve(call)),
    release: vi.fn(),
  }
}

export function mockPreparedGeneration(
  generation: {
    id: string
    completion: Promise<{
      status: "completed" | "failed"
      text: string
      reasoning: string
      error?: string
      failureKind?: string
    }>
  } = completedGenerationHandle(),
) {
  const prepared = {
    id: generation.id,
    start: vi.fn(() => generation),
    fail: vi.fn(() => generation),
  }
  mocks.prepareTextGeneration.mockReturnValueOnce(prepared)
  return prepared
}


export function resetGenerateTextMocks() {
  vi.clearAllMocks()
  mocks.reserveLlmCall.mockImplementation(
    (
      userId: string,
      snapshot: LlmModelAssignmentSnapshot,
      _signal?: AbortSignal,
    ) =>
      Promise.resolve({
        resolve: () => mocks.resolveLlmCall(userId, snapshot),
        release: mocks.reservationRelease,
      }),
  )
  mocks.resolveLlmCall.mockImplementation(
    (_userId, snapshot) =>
      Promise.resolve(
        serverLlmCall(
          snapshot.assignment.reasoningEffort,
          snapshot.assignment.modelId,
        ),
      ),
  )
}
