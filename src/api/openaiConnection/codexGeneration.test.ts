import { beforeEach, describe, expect, it, vi } from "vitest"

const mocks = vi.hoisted(() => ({
  createModels: vi.fn(),
  fetch: vi.fn(),
  getAuth: vi.fn(),
  hasOpenAiCodexConnection: vi.fn(),
  setProvider: vi.fn(),
  startPiLlmStream: vi.fn((_runtime: unknown, _request: unknown) => ({
    stream: {},
  })),
}))

let provider: {
  id: string
  baseUrl: string
  getModels(): { id: string }[]
}
let modelRegistry: {
  setProvider: ReturnType<typeof vi.fn>
  getProvider(providerId: string): typeof provider | undefined
  getModel(providerId: string, id: string): { id: string } | undefined
  getAuth(providerId: string, options: unknown): Promise<unknown>
}

vi.mock("@earendil-works/pi-ai", async (importOriginal) => ({
  ...await importOriginal<typeof import("@earendil-works/pi-ai")>(),
  createModels: mocks.createModels,
}))

vi.mock("@earendil-works/pi-ai/providers/openai-codex", () => ({
  openaiCodexProvider: () => ({
    id: "openai-codex",
    baseUrl: "https://chatgpt.com/backend-api",
    getModels: () => [{ id: "bundled-only" }],
  }),
}))

vi.mock("../web_search/boundedFetch.ts", () => ({
  createBoundedFetch: () => mocks.fetch,
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
const token = `header.${Buffer.from(JSON.stringify({
  "https://api.openai.com/auth": { chatgpt_account_id: "test-account" },
})).toString("base64url")}.signature`
const otherAccountToken = `header.${Buffer.from(JSON.stringify({
  "https://api.openai.com/auth": { chatgpt_account_id: "other-account" },
})).toString("base64url")}.signature`

function remoteModel(
  slug: string,
  efforts = ["low", "medium", "high", "xhigh", "max", "ultra"],
) {
  return {
    slug,
    display_name: `Name ${slug}`,
    description: `Description ${slug}`,
    visibility: "list",
    supported_in_api: true,
    input_modalities: ["text", "image"],
    context_window: 272_000,
    supported_reasoning_levels: efforts.map((effort) => ({ effort })),
  }
}

function catalogResponse(models: unknown[]): Response {
  return new Response(JSON.stringify({ models }), {
    status: 200,
    headers: { "content-type": "application/json" },
  })
}

async function acquire(
  modelId = "gpt-6-sol",
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
  mocks.hasOpenAiCodexConnection.mockReturnValue(true)
  mocks.getAuth.mockResolvedValue({ auth: { apiKey: token } })
  mocks.fetch.mockResolvedValue(catalogResponse([remoteModel("gpt-6-sol")]))
  modelRegistry = {
    setProvider: mocks.setProvider,
    getProvider: (_providerId) => provider,
    getModel: (_providerId, id) => provider.getModels().find((model) => model.id === id),
    getAuth: mocks.getAuth,
  }
  mocks.setProvider.mockImplementation((nextProvider: unknown) => {
    provider = nextProvider as typeof provider
  })
  mocks.createModels.mockReturnValue(modelRegistry)
})

function requireRecord(value: unknown): Record<string, unknown> {
  if (value === null || typeof value !== "object") {
    throw new TypeError("Expected a record")
  }
  return value as Record<string, unknown>
}

describe("live Codex catalog", () => {
  it("lists a new account model in server order with only its executable efforts", async () => {
    mocks.fetch.mockResolvedValue(catalogResponse([
      remoteModel("gpt-6-sol"),
      remoteModel("gpt-5.6-luna", ["none", "minimal", "low"]),
      remoteModel("plain-text", []),
    ]))

    await expect(listAvailableCodexModels(userId)).resolves.toEqual([
      {
        id: "gpt-6-sol",
        displayName: "Name gpt-6-sol",
        description: "Description gpt-6-sol",
        isDefault: false,
        supportedReasoningEfforts: [
          { reasoningEffort: "low" },
          { reasoningEffort: "medium" },
          { reasoningEffort: "high" },
          { reasoningEffort: "xhigh" },
          { reasoningEffort: "max" },
        ],
      },
      {
        id: "gpt-5.6-luna",
        displayName: "Name gpt-5.6-luna",
        description: "Description gpt-5.6-luna",
        isDefault: false,
        supportedReasoningEfforts: [
          { reasoningEffort: "none" },
          { reasoningEffort: "minimal" },
          { reasoningEffort: "low" },
        ],
      },
      {
        id: "plain-text",
        displayName: "Name plain-text",
        description: "Description plain-text",
        isDefault: false,
        supportedReasoningEfforts: [{ reasoningEffort: "none" }],
      },
    ])
    expect(mocks.getAuth).toHaveBeenCalledTimes(2)
    const [providerId, options] = mocks.getAuth.mock.calls[0] as [
      string,
      { signal: AbortSignal },
    ]
    expect(providerId).toBe("openai-codex")
    expect(options.signal).toBeInstanceOf(AbortSignal)
    expect(mocks.fetch).toHaveBeenCalledOnce()
    const [url, request] = mocks.fetch.mock.calls[0] as [
      URL,
      { headers: Record<string, string>; signal: AbortSignal },
    ]
    expect(url.toString()).toBe(
      "https://chatgpt.com/backend-api/codex/models?client_version=1.0.0",
    )
    expect(request.headers).toMatchObject({
      authorization: `Bearer ${token}`,
      "chatgpt-account-id": "test-account",
      originator: "pi",
    })
    expect(request.signal).toBeInstanceOf(AbortSignal)
  })

  it("filters hidden, non-text, and Pi-unsupported models", async () => {
    mocks.fetch.mockResolvedValue(catalogResponse([
      { ...remoteModel("hidden"), visibility: "hide", context_window: undefined },
      { ...remoteModel("no-api"), supported_in_api: false },
      { ...remoteModel("image-only"), input_modalities: ["image"] },
      { ...remoteModel("no-context"), context_window: null },
      remoteModel("ultra-only", ["ultra"]),
      { ...remoteModel("legacy-no-modalities"), input_modalities: undefined },
      remoteModel("visible", ["high"]),
    ]))

    const listed = await listAvailableCodexModels(userId)
    expect(listed?.map((model) => model.id)).toEqual([
      "no-api", "legacy-no-modalities", "visible",
    ])
  })

  it("fails closed on malformed or failed catalog responses", async () => {
    mocks.fetch.mockResolvedValueOnce(catalogResponse([{
      ...remoteModel("bad"),
      supported_reasoning_levels: "high",
    }]))
    await expect(listAvailableCodexModels(userId)).rejects.toMatchObject({
      name: "OpenAiCodexError",
      code: "temporarily-unavailable",
    })

    mocks.fetch.mockResolvedValueOnce(new Response(null, { status: 503 }))
    await expect(listAvailableCodexModels(userId)).rejects.toMatchObject({
      code: "temporarily-unavailable",
    })
    expect(mocks.startPiLlmStream).not.toHaveBeenCalled()
  })

  it("classifies authentication failure and requires a refreshed bearer token", async () => {
    mocks.fetch.mockResolvedValueOnce(new Response(null, { status: 401 }))
    await expect(listAvailableCodexModels(userId)).rejects.toMatchObject({
      code: "authentication-required",
    })

    mocks.getAuth.mockResolvedValueOnce({ auth: {} })
    await expect(listAvailableCodexModels(userId)).rejects.toMatchObject({
      code: "authentication-required",
    })
  })

  it("returns no catalog or reservation without a connection", async () => {
    mocks.hasOpenAiCodexConnection.mockReturnValue(false)

    await expect(listAvailableCodexModels(userId)).resolves.toBeUndefined()
    await expect(acquire()).resolves.toBeUndefined()
    expect(mocks.createModels).not.toHaveBeenCalled()
    expect(mocks.fetch).not.toHaveBeenCalled()
  })

  it("does not return a catalog if the connection disappears during fetch", async () => {
    mocks.fetch.mockImplementationOnce(() => {
      mocks.hasOpenAiCodexConnection.mockReturnValue(false)
      return Promise.resolve(catalogResponse([remoteModel("gpt-6-sol")]))
    })

    await expect(listAvailableCodexModels(userId)).resolves.toBeUndefined()
  })

  it("rejects a catalog if the connected account changes during fetch", async () => {
    mocks.getAuth.mockResolvedValueOnce({ auth: { apiKey: token } })
      .mockResolvedValueOnce({ auth: { apiKey: otherAccountToken } })

    await expect(listAvailableCodexModels(userId)).rejects.toMatchObject({
      code: "temporarily-unavailable",
    })
  })
})

describe("Codex generation acquisition", () => {
  it("uses an unbundled live model and its exact selected effort", async () => {
    const generation = await acquire("gpt-6-sol", "max")

    expect(generation).toMatchObject({ modelId: "gpt-6-sol" })
    const request = { system: "system", prompt: "prompt" }
    generation?.start(request)
    await generation?.release()
    expect(mocks.startPiLlmStream).toHaveBeenCalledOnce()
    const [runtime, sentRequest] = mocks.startPiLlmStream.mock.calls[0] ?? []
    const runtimeRecord = requireRecord(runtime)
    expect(runtimeRecord.models).toBe(modelRegistry)
    expect(runtimeRecord.model).toMatchObject({
      id: "gpt-6-sol",
      api: "openai-codex-responses",
      compat: { supportsOpenAIGrammarTools: true },
      thinkingLevelMap: { max: "max" },
    })
    const selectedModel = requireRecord(runtimeRecord.model)
    expect(Object.hasOwn(requireRecord(selectedModel.thinkingLevelMap), "ultra"))
      .toBe(false)
    expect(runtimeRecord.provider).toBe("codex")
    expect(runtimeRecord.reasoningEffort).toBe("max")
    expect(sentRequest).toEqual(request)
  })

  it.each([
    ["unknown model", "missing", "high"],
    ["unsupported effort", "gpt-6-sol", "minimal"],
    ["Pi-unsupported ultra effort", "gpt-6-sol", "ultra"],
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

  it("does not fall back when live discovery itself is incompatible", async () => {
    mocks.fetch.mockResolvedValueOnce(new Response(null, { status: 400 }))
    await expect(acquire("gpt-6-sol", "high", true)).rejects.toMatchObject({
      code: "protocol-incompatible",
    })
  })

  it("fails an explicit selection when live discovery fails", async () => {
    mocks.fetch.mockRejectedValueOnce(new Error("network unavailable"))
    await expect(acquire()).rejects.toMatchObject({
      code: "temporarily-unavailable",
    })
    expect(mocks.startPiLlmStream).not.toHaveBeenCalled()
  })

  it("returns the fallback seam if the connection disappears before acquire", async () => {
    const reservation = await reserveCodexGeneration(userId, {
      modelId: "gpt-6-sol",
      reasoningEffort: "high",
      allowUnavailableRecommendationFallback: true,
    })
    mocks.hasOpenAiCodexConnection.mockReturnValue(false)

    await expect(reservation?.acquire()).resolves.toBeUndefined()
    expect(mocks.fetch).not.toHaveBeenCalled()
  })

  it("does not start generation if the connection disappears during discovery", async () => {
    mocks.fetch.mockImplementationOnce(() => {
      mocks.hasOpenAiCodexConnection.mockReturnValue(false)
      return Promise.resolve(catalogResponse([remoteModel("gpt-6-sol")]))
    })

    await expect(acquire()).resolves.toBeUndefined()
    expect(mocks.startPiLlmStream).not.toHaveBeenCalled()
  })

  it("does not start generation if the connected account changes", async () => {
    mocks.getAuth.mockResolvedValueOnce({ auth: { apiKey: token } })
      .mockResolvedValueOnce({ auth: { apiKey: otherAccountToken } })

    await expect(acquire()).rejects.toMatchObject({
      code: "temporarily-unavailable",
    })
    expect(mocks.startPiLlmStream).not.toHaveBeenCalled()
  })

  it("preserves workflow cancellation during catalog discovery", async () => {
    const controller = new AbortController()
    const reason = new Error("Stopped workflow")
    const reservation = await reserveCodexGeneration(userId, {
      modelId: "gpt-6-sol",
      reasoningEffort: "high",
      allowUnavailableRecommendationFallback: false,
    }, controller.signal)
    mocks.fetch.mockImplementationOnce((_url: unknown, request: { signal: AbortSignal }) =>
      new Promise((_resolve, reject) => {
        request.signal.addEventListener("abort", () => reject(reason), {
          once: true,
        })
        controller.abort(reason)
      })
    )

    await expect(reservation?.acquire()).rejects.toBe(reason)
    expect(mocks.startPiLlmStream).not.toHaveBeenCalled()
    const next = await reserveCodexGeneration(userId, {
      modelId: "gpt-6-sol",
      reasoningEffort: "high",
      allowUnavailableRecommendationFallback: false,
    })
    expect(next).toBeDefined()
    next?.release()
  })
})

describe("Codex generation reservation", () => {
  it("consumes a reservation at most once", async () => {
    const reservation = await reserveCodexGeneration(userId, {
      modelId: "gpt-6-sol",
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
      modelId: "gpt-6-sol",
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
      modelId: "gpt-6-sol",
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
      modelId: "gpt-6-sol",
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
