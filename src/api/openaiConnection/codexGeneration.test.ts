import { beforeEach, describe, expect, it, vi } from "vitest"

type FakeModel = {
  id: string
  name: string
  api: string
  levels: string[]
}

const mocks = vi.hoisted(() => ({
  createModels: vi.fn(),
  getAuth: vi.fn(),
  getSupportedThinkingLevels: vi.fn(),
  hasApi: vi.fn(),
  hasOpenAiCodexConnection: vi.fn(),
  models: [] as FakeModel[],
  setProvider: vi.fn(),
  startPiLlmStream: vi.fn((_runtime: unknown, _request: unknown) => ({
    stream: {},
  })),
}))

let modelRegistry: {
  setProvider: ReturnType<typeof vi.fn>
  getModels(): FakeModel[]
  getModel(provider: string, id: string): FakeModel | undefined
  getAuth(provider: string, options: unknown): Promise<unknown>
}

vi.mock("@earendil-works/pi-ai", () => ({
  createModels: mocks.createModels,
  getSupportedThinkingLevels: mocks.getSupportedThinkingLevels,
  hasApi: mocks.hasApi,
}))

vi.mock("@earendil-works/pi-ai/providers/openai-codex", () => ({
  openaiCodexProvider: () => ({ id: "openai-codex" }),
}))

vi.mock("./credentialsRepository.ts", () => ({
  hasOpenAiCodexConnection: mocks.hasOpenAiCodexConnection,
}))

vi.mock("../llms/piGeneration.ts", () => ({
  startPiLlmStream: mocks.startPiLlmStream,
}))

vi.mock("./piCredentials.ts", () => ({
  PI_CODEX_PROVIDER_ID: "openai-codex",
  PiCodexCredentialStore: class PiCodexCredentialStore {},
}))

import {
  listAvailableCodexModels,
  reserveCodexGeneration,
} from "./codexGeneration.ts"

const userId = "connected-user"

function fakeModel(
  id: string,
  levels = ["off", "low", "high"],
): FakeModel {
  return { id, name: `Name ${id}`, api: "openai-codex-responses", levels }
}

async function acquire(
  modelId = "gpt-selected",
  reasoningEffort = "high",
  allowUnavailableRecommendationFallback = false,
) {
  const reservation = await reserveCodexGeneration(userId, {
    modelId,
    reasoningEffort: reasoningEffort as "high",
    allowUnavailableRecommendationFallback,
  })
  return reservation?.acquire()
}

beforeEach(() => {
  vi.clearAllMocks()
  mocks.models = [fakeModel("gpt-selected")]
  mocks.hasOpenAiCodexConnection.mockReturnValue(true)
  mocks.getAuth.mockResolvedValue({ auth: { apiKey: "access-token" } })
  modelRegistry = {
    setProvider: mocks.setProvider,
    getModels: () => mocks.models,
    getModel: (_provider: string, id: string) =>
      mocks.models.find((model) => model.id === id),
    getAuth: mocks.getAuth,
  }
  mocks.createModels.mockReturnValue(modelRegistry)
  mocks.getSupportedThinkingLevels.mockImplementation(
    (model: FakeModel) => model.levels,
  )
  mocks.hasApi.mockImplementation(
    (model: FakeModel, api: string) => model.api === api,
  )
})

function requireRecord(value: unknown): Record<string, unknown> {
  if (value === null || typeof value !== "object") {
    throw new TypeError("Expected a record")
  }
  return value as Record<string, unknown>
}

describe("Codex generation acquisition", () => {
  it("lists Pi models with exact supported reasoning efforts", async () => {
    mocks.models = [
      fakeModel("gpt-visible", [
        "off",
        "minimal",
        "low",
        "medium",
        "high",
        "xhigh",
        "max",
      ]),
    ]

    await expect(listAvailableCodexModels(userId)).resolves.toEqual([
      {
        id: "gpt-visible",
        displayName: "Name gpt-visible",
        isDefault: false,
        supportedReasoningEfforts: [
          { reasoningEffort: "none" },
          { reasoningEffort: "minimal" },
          { reasoningEffort: "low" },
          { reasoningEffort: "medium" },
          { reasoningEffort: "high" },
          { reasoningEffort: "xhigh" },
          { reasoningEffort: "max" },
        ],
      },
    ])
    expect(mocks.setProvider).toHaveBeenCalledWith({ id: "openai-codex" })
    expect(mocks.getAuth).toHaveBeenCalledOnce()
    const [provider, options] = mocks.getAuth.mock.calls[0] as [
      string,
      { signal: AbortSignal },
    ]
    expect(provider).toBe("openai-codex")
    expect(options.signal).toBeInstanceOf(AbortSignal)
  })

  it("returns no catalog or reservation without a connection", async () => {
    mocks.hasOpenAiCodexConnection.mockReturnValue(false)

    await expect(listAvailableCodexModels(userId)).resolves.toBeUndefined()
    await expect(acquire()).resolves.toBeUndefined()
    expect(mocks.createModels).not.toHaveBeenCalled()
  })

  it("uses the selected Pi model and exact supported effort", async () => {
    const generation = await acquire("gpt-selected", "low")

    expect(generation).toMatchObject({ modelId: "gpt-selected" })
    const request = {
      system: "system",
      prompt: "prompt",
    }
    generation?.start(request)
    expect(mocks.startPiLlmStream).toHaveBeenCalledOnce()
    const [runtime, sentRequest] = mocks.startPiLlmStream.mock.calls[0] ?? []
    const runtimeRecord = requireRecord(runtime)
    expect(runtimeRecord.models).toBe(modelRegistry)
    expect(runtimeRecord.model).toBe(mocks.models[0])
    expect(runtimeRecord.provider).toBe("codex")
    expect(runtimeRecord.reasoningEffort).toBe("low")
    expect(sentRequest).toEqual(request)
    await generation?.release()
  })

  it.each([
    ["unknown model", "missing", "high"],
    ["unsupported effort", "gpt-selected", "xhigh"],
    ["Pi-unsupported ultra effort", "gpt-selected", "ultra"],
  ])("rejects an explicit %s", async (_name, modelId, effort) => {
    await expect(acquire(modelId, effort)).rejects.toMatchObject({
      name: "OpenAiCodexError",
      code: "protocol-incompatible",
    })
    expect(mocks.startPiLlmStream).not.toHaveBeenCalled()
  })

  it("returns the fallback seam for an unavailable recommendation", async () => {
    await expect(acquire("missing", "high", true)).resolves.toBeUndefined()
  })

  it("returns the fallback seam if the connection disappears before acquire", async () => {
    const reservation = await reserveCodexGeneration(userId, {
      modelId: "gpt-selected",
      reasoningEffort: "high",
      allowUnavailableRecommendationFallback: true,
    })
    mocks.hasOpenAiCodexConnection.mockReturnValue(false)

    await expect(reservation?.acquire()).resolves.toBeUndefined()
  })
})

describe("Codex generation reservation", () => {
  it("consumes a reservation at most once", async () => {
    const reservation = await reserveCodexGeneration(userId, {
      modelId: "gpt-selected",
      reasoningEffort: "high",
      allowUnavailableRecommendationFallback: false,
    })
    const generation = await reservation?.acquire()
    await generation?.release()

    await expect(reservation?.acquire()).rejects.toThrow(
      "reservation was already consumed",
    )
  })

  it("serializes same-user reservations before global generation admission", async () => {
    const selection = {
      modelId: "gpt-selected",
      reasoningEffort: "high" as const,
      allowUnavailableRecommendationFallback: false,
    }
    const first = await reserveCodexGeneration("serialized-user", selection)
    const secondPromise = reserveCodexGeneration("serialized-user", selection)
    let secondSettled = false
    void secondPromise.then(() => {
      secondSettled = true
    })

    await Promise.resolve()
    expect(secondSettled).toBe(false)
    first?.release()

    const second = await secondPromise
    expect(second).toBeDefined()
    second?.release()
  })

  it("removes an aborted same-user waiter without releasing the active reservation", async () => {
    const selection = {
      modelId: "gpt-selected",
      reasoningEffort: "high" as const,
      allowUnavailableRecommendationFallback: false,
    }
    const first = await reserveCodexGeneration("abortable-user", selection)
    const controller = new AbortController()
    const reason = new Error("Stopped while waiting for Codex")
    const waiting = reserveCodexGeneration(
      "abortable-user",
      selection,
      controller.signal,
    )

    controller.abort(reason)

    await expect(waiting).rejects.toBe(reason)
    first?.release()
    const next = await reserveCodexGeneration("abortable-user", selection)
    expect(next).toBeDefined()
    next?.release()
  })

  it("allows different users to reserve Codex independently", async () => {
    const selection = {
      modelId: "gpt-selected",
      reasoningEffort: "high" as const,
      allowUnavailableRecommendationFallback: false,
    }
    const first = await reserveCodexGeneration("independent-user-a", selection)
    const second = await reserveCodexGeneration("independent-user-b", selection)

    expect(first).toBeDefined()
    expect(second).toBeDefined()
    first?.release()
    second?.release()
  })
})
