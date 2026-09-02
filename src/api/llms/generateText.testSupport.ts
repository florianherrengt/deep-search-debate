import { vi } from "vitest"

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
  callOptions: vi.fn((reasoning: "enabled" | "disabled") => ({
    providerOptions: { test: { reasoning } },
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
      _reasoning: "enabled" | "disabled",
      _modelOverride?: string,
    ): Promise<MockLlmCall> =>
      Promise.resolve({
        model: { modelId: "configured-model" },
        modelId: "configured-model",
        provider: "server",
        supportsStructuredOutputs: false,
        callOptions: {},
        wrapStream: (source: unknown) => source,
        release: () => Promise.resolve(),
      }),
  ),
  reserveLlmCall: vi.fn(
    (userId: string, _signal?: AbortSignal) =>
      Promise.resolve({
        resolve: (
          reasoning: "enabled" | "disabled",
          modelOverride?: string,
        ) => mocks.resolveLlmCall(userId, reasoning, modelOverride),
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
  reasoning: "enabled" | "disabled",
  modelOverride?: string,
) {
  const model = mocks.model(modelOverride)
  return {
    model,
    modelId: model.modelId,
    provider: "server" as "server" | "codex",
    supportsStructuredOutputs: false,
    callOptions: mocks.callOptions(reasoning),
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
    (userId: string, _signal?: AbortSignal) =>
      Promise.resolve({
        resolve: (
          reasoning: "enabled" | "disabled",
          modelOverride?: string,
        ) => mocks.resolveLlmCall(userId, reasoning, modelOverride),
        release: mocks.reservationRelease,
      }),
  )
  mocks.resolveLlmCall.mockImplementation(
    (_userId, reasoning, modelOverride) =>
      Promise.resolve(serverLlmCall(reasoning, modelOverride)),
  )
}
