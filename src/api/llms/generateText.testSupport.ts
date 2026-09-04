import { vi } from "vitest"

import type { LlmModelAssignmentSnapshot } from "./modelSettings.ts"
import type { PiLlmRequest } from "./piGeneration.ts"
import type { StartedLlmStream } from "./streamTypes.ts"

type MockLlmCall = {
  modelId: string
  provider: "server" | "codex"
  start(request: PiLlmRequest): StartedLlmStream
  release(): Promise<void>
}

function emptyStream(): StartedLlmStream["stream"] {
  return (async function* () {})()
}

export function startedLlmStream(
  overrides: Partial<StartedLlmStream> = {},
): StartedLlmStream {
  return {
    stream: emptyStream(),
    finishReason: Promise.resolve("stop"),
    rawFinishReason: Promise.resolve("stop"),
    usage: Promise.resolve({
      inputTokens: 0,
      inputTokenDetails: {
        noCacheTokens: 0,
        cacheReadTokens: 0,
        cacheWriteTokens: 0,
      },
      outputTokens: 0,
      outputTokenDetails: { textTokens: 0, reasoningTokens: 0 },
      totalTokens: 0,
    }),
    ...overrides,
  }
}

export const mocks = {
  loadPrompt: vi.fn(),
  prepareTextGeneration: vi.fn(),
  release: vi.fn(() => Promise.resolve()),
  reservationRelease: vi.fn(),
  requirePositiveCreditBalance: vi.fn(),
  resolveLlmCall: vi.fn(
    (
      _userId: string,
      snapshot: LlmModelAssignmentSnapshot,
    ): Promise<MockLlmCall> =>
      Promise.resolve(serverLlmCall(snapshot.assignment.modelId)),
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
  start: vi.fn<(request: PiLlmRequest) => StartedLlmStream>(() =>
    startedLlmStream()
  ),
}

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

async function awaitCompletedText(generation: {
  completion: Promise<{
    status: "completed" | "failed" | "interrupted"
    text: string
    error?: string
  }>
}) {
  const outcome = await generation.completion
  if (outcome.status !== "completed") throw new Error(outcome.error)
  return outcome.text
}

vi.mock("./streams.ts", () => ({
  awaitGenerationText: awaitCompletedText,
  awaitGenerationOutput: async (
    generation: Parameters<typeof awaitCompletedText>[0],
    output: Promise<unknown>,
  ) => {
    const [completionResult, outputResult] = await Promise.allSettled([
      generation.completion,
      output,
    ])
    if (completionResult.status === "rejected") throw completionResult.reason
    if (completionResult.value.status !== "completed") {
      throw new Error(completionResult.value.error)
    }
    if (outputResult.status === "rejected") throw outputResult.reason
    return outputResult.value
  },
  prepareTextGeneration: mocks.prepareTextGeneration,
}))

vi.mock("./provider.ts", () => ({ reserveLlmCall: mocks.reserveLlmCall }))

export function completedGenerationHandle(text = "Persisted output") {
  return {
    id: "stream-id",
    completion: Promise.resolve({
      status: "completed" as const,
      text,
      reasoning: "Persisted reasoning",
    }),
  }
}

export function serverLlmCall(modelId: string) {
  return {
    modelId,
    provider: "server" as "server" | "codex",
    start: mocks.start,
    release: mocks.release,
  }
}

export function subscriptionLlmCall(options?: {
  start?: (request: PiLlmRequest) => StartedLlmStream
  release?: () => Promise<void>
}) {
  return {
    modelId: "gpt-5.6-sol",
    provider: "codex" as const,
    start: options?.start ?? vi.fn(() => startedLlmStream()),
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
      status: "completed" | "failed" | "interrupted"
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
  mocks.start.mockImplementation(() => startedLlmStream())
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
  mocks.resolveLlmCall.mockImplementation((_userId, snapshot) =>
    Promise.resolve(serverLlmCall(snapshot.assignment.modelId))
  )
}
