import { beforeEach, describe, expect, it, vi } from "vitest"

type Connection = {
  userId: string
  connectionId: string
  credentials: Buffer
}

type ListedModel = {
  id: string
  isDefault: boolean
  hidden?: boolean
  supportedReasoningEfforts?: { reasoningEffort: string }[]
}

type FakeProvider = ReturnType<typeof vi.fn> & {
  close: ReturnType<typeof vi.fn>
  listModels: ReturnType<typeof vi.fn>
  modelCalls: { modelId: string; settings: unknown }[]
}

const mocks = vi.hoisted(() => ({
  FatalCodexContainmentError: class FatalCodexContainmentError extends Error {},
  acquireCodexProcess: vi.fn(),
  codexProcessEnvironment: vi.fn(),
  compareAndSwapOpenAiCodexCredentials: vi.fn(),
  createCodexAppServer: vi.fn(),
  createCodexHome: vi.fn(),
  getCodexExecutablePath: vi.fn(),
  getOpenAiCodexConnection: vi.fn(),
  hasOpenAiCodexConnection: vi.fn(),
  homeCredentialSnapshots: [] as Buffer[],
  readCodexCredentials: vi.fn(),
  reapCodexProcessGroup: vi.fn(),
  releaseProcess: vi.fn(),
  removeCodexHome: vi.fn(),
  terminateApiForUnreapedCodexProcess: vi.fn(),
}))

vi.mock("ai-sdk-provider-codex-cli", () => ({
  createCodexAppServer: mocks.createCodexAppServer,
}))

vi.mock("./credentialsRepository.ts", () => ({
  compareAndSwapOpenAiCodexCredentials:
    mocks.compareAndSwapOpenAiCodexCredentials,
  getOpenAiCodexConnection: mocks.getOpenAiCodexConnection,
  hasOpenAiCodexConnection: mocks.hasOpenAiCodexConnection,
}))

vi.mock("./codexSession/home.ts", () => ({
  createCodexHome: mocks.createCodexHome,
  readCodexCredentials: mocks.readCodexCredentials,
  removeCodexHome: mocks.removeCodexHome,
}))

vi.mock("./codexSession/policy.ts", () => ({
  hardenedCodexConfigOverrides: { tools: { shell: false } },
}))

vi.mock("./codexSession/process.ts", () => ({
  codexProcessEnvironment: mocks.codexProcessEnvironment,
  FatalCodexContainmentError: mocks.FatalCodexContainmentError,
  getCodexExecutablePath: mocks.getCodexExecutablePath,
  reapCodexProcessGroup: mocks.reapCodexProcessGroup,
  terminateApiForUnreapedCodexProcess:
    mocks.terminateApiForUnreapedCodexProcess,
}))

vi.mock("./codexProcessSlots.ts", () => ({
  acquireCodexProcess: mocks.acquireCodexProcess,
}))

import {
  listAvailableCodexModels,
  reserveCodexGeneration,
} from "./codexGeneration.ts"

const userId = "connected-user"
const fakeHome = {
  root: "/tmp/rethinkloop-codex-generation-test",
  home: "/tmp/rethinkloop-codex-generation-test/home",
  work: "/tmp/rethinkloop-codex-generation-test/work",
  control: "/tmp/rethinkloop-codex-generation-test/control",
  rootIdentity: { dev: 1n, ino: 2n },
}

function useConnection(value = "initial-credentials"): Connection {
  const connection = {
    userId,
    connectionId: "connection-1",
    credentials: Buffer.from(value),
  }
  mocks.hasOpenAiCodexConnection.mockReturnValue(true)
  mocks.getOpenAiCodexConnection.mockReturnValue(connection)
  mocks.readCodexCredentials.mockResolvedValue(Buffer.from(value))
  return connection
}

async function acquireReservedGeneration(
  reasoningEffort: "low" | "high" | "ultra",
  signal?: AbortSignal,
  modelId = "gpt-default",
) {
  const reservation = await reserveCodexGeneration(
    userId,
    {
      modelId,
      reasoningEffort,
      allowUnavailableRecommendationFallback: false,
    },
    signal,
  )
  return reservation?.acquire()
}

function useProvider(models: ListedModel[]): FakeProvider {
  const modelCalls: { modelId: string; settings: unknown }[] = []
  const provider = Object.assign(
    vi.fn((modelId: string, settings: unknown) => {
      modelCalls.push({ modelId, settings })
      return { modelId }
    }),
    {
      close: vi.fn(() => Promise.resolve()),
      listModels: vi.fn(() => Promise.resolve({ models })),
      modelCalls,
    },
  )
  mocks.createCodexAppServer.mockReturnValue(provider)
  return provider
}

async function collect<Part>(source: AsyncIterable<Part>): Promise<Part[]> {
  const parts: Part[] = []
  for await (const part of source) parts.push(part)
  return parts
}

function streamOf<Part>(...parts: Part[]): AsyncIterable<Part> {
  return {
    [Symbol.asyncIterator]() {
      let index = 0
      return {
        next: () =>
          Promise.resolve(
            index < parts.length
              ? { done: false as const, value: parts[index++] }
              : { done: true as const, value: undefined },
          ),
      }
    },
  }
}

beforeEach(() => {
  vi.clearAllMocks()
  mocks.homeCredentialSnapshots.length = 0
  mocks.hasOpenAiCodexConnection.mockReturnValue(false)
  mocks.acquireCodexProcess.mockResolvedValue(mocks.releaseProcess)
  mocks.createCodexHome.mockImplementation((credentials: Buffer) => {
    mocks.homeCredentialSnapshots.push(Buffer.from(credentials))
    return Promise.resolve(fakeHome)
  })
  mocks.codexProcessEnvironment.mockReturnValue({ HOME: fakeHome.home })
  mocks.getCodexExecutablePath.mockReturnValue("/usr/local/bin/codex-test")
  mocks.reapCodexProcessGroup.mockResolvedValue(undefined)
  mocks.removeCodexHome.mockResolvedValue(undefined)
  mocks.terminateApiForUnreapedCodexProcess.mockImplementation(() => {
    throw new mocks.FatalCodexContainmentError()
  })
  useProvider([
    {
      id: "gpt-default",
      isDefault: true,
      supportedReasoningEfforts: [
        { reasoningEffort: "low" },
        { reasoningEffort: "high" },
      ],
    },
  ])
})

describe("Codex generation acquisition", () => {
  it("lists only visible models that advertise at least one effort", async () => {
    useConnection()
    const provider = useProvider([
      {
        id: "visible",
        isDefault: false,
        supportedReasoningEfforts: [{ reasoningEffort: "medium" }],
      },
      {
        id: "hidden",
        isDefault: true,
        supportedReasoningEfforts: [{ reasoningEffort: "high" }],
        hidden: true,
      },
      {
        id: "no-efforts",
        isDefault: false,
        supportedReasoningEfforts: [],
      },
    ])

    await expect(listAvailableCodexModels(userId)).resolves.toEqual([
      expect.objectContaining({ id: "visible" }),
    ])
    expect(provider.close).toHaveBeenCalledOnce()
    expect(mocks.releaseProcess).toHaveBeenCalledOnce()
  })

  it("returns the fallback seam without starting a process when no connection exists", async () => {
    await expect(
      acquireReservedGeneration("high"),
    ).resolves.toBeUndefined()

    expect(mocks.acquireCodexProcess).not.toHaveBeenCalled()
    expect(mocks.getOpenAiCodexConnection).not.toHaveBeenCalled()
    expect(mocks.createCodexAppServer).not.toHaveBeenCalled()
  })

  it("falls back if the connection disappears while waiting for its process slot", async () => {
    mocks.hasOpenAiCodexConnection.mockReturnValue(true)
    mocks.getOpenAiCodexConnection.mockReturnValue(undefined)

    await expect(
      acquireReservedGeneration("low"),
    ).resolves.toBeUndefined()

    expect(mocks.acquireCodexProcess).toHaveBeenCalledWith(userId, {})
    expect(mocks.releaseProcess).toHaveBeenCalledOnce()
    expect(mocks.createCodexAppServer).not.toHaveBeenCalled()
  })

  it.each(["ultra", "low"] as const)(
    "uses the exact selected model and %s effort",
    async (expectedEffort) => {
      useConnection()
      const provider = useProvider([
        {
          id: "server-model-override-that-must-be-ignored",
          isDefault: false,
          supportedReasoningEfforts: [{ reasoningEffort: "medium" }],
        },
        {
          id: "account-default-model",
          isDefault: true,
          supportedReasoningEfforts: [
            { reasoningEffort: "medium" },
            { reasoningEffort: "ultra" },
            { reasoningEffort: "low" },
          ],
        },
      ])

      const generation = await acquireReservedGeneration(
        expectedEffort,
        undefined,
        "account-default-model",
      )

      expect(generation).toMatchObject({ modelId: "account-default-model" })
      expect(provider.modelCalls).toEqual([
        {
          modelId: "account-default-model",
          settings: {
            configOverrides: {
              tools: { shell: false },
              model_reasoning_effort: expectedEffort,
            },
          },
        },
      ])
      await generation?.release()
    },
  )

  it("propagates fatal containment and retains the user lease when home creation cannot roll back", async () => {
    const connection = useConnection()
    mocks.createCodexHome.mockRejectedValueOnce(
      new mocks.FatalCodexContainmentError(),
    )

    await expect(
      acquireReservedGeneration("high"),
    ).rejects.toBeInstanceOf(mocks.FatalCodexContainmentError)

    expect(mocks.releaseProcess).not.toHaveBeenCalled()
    expect(mocks.createCodexAppServer).not.toHaveBeenCalled()
    expect(connection.credentials.every((byte) => byte === 0)).toBe(true)
  })

  it.each([
    ["no matching", []],
    [
      "an unsupported effort on the matching",
      [
        {
          id: "gpt-default",
          isDefault: true,
          supportedReasoningEfforts: [{ reasoningEffort: "low" }],
        },
      ],
    ],
  ] satisfies [string, ListedModel[]][])(
    "rejects a model list with %s model",
    async (_description, models) => {
      const connection = useConnection()
      const provider = useProvider(models)

      await expect(
        acquireReservedGeneration("high"),
      ).rejects.toMatchObject({
        name: "OpenAiCodexError",
        code: "protocol-incompatible",
      })

      expect(provider.close).toHaveBeenCalledOnce()
      expect(mocks.reapCodexProcessGroup).toHaveBeenCalledOnce()
      expect(mocks.releaseProcess).toHaveBeenCalledOnce()
      expect(connection.credentials.every((byte) => byte === 0)).toBe(true)
    },
  )

  it.each([
    ["status 429: upstream-rate-secret", "rate-limited"],
    ["status 401: bearer upstream-auth-secret", "authentication-required"],
  ] as const)(
    "sanitizes provider startup failure %s",
    async (rawMessage, expectedCode) => {
      useConnection()
      const provider = useProvider([])
      provider.listModels.mockRejectedValue(new Error(rawMessage))

      let thrown: unknown
      try {
        await acquireReservedGeneration("high")
      } catch (error) {
        thrown = error
      }

      expect(thrown).toMatchObject({
        name: "OpenAiCodexError",
        code: expectedCode,
      })
      expect((thrown as Error).message).not.toContain("upstream")
    },
  )
})

describe("Codex generation stream boundary", () => {
  it("fails closed on tool events and releases the process exactly once", async () => {
    const connection = useConnection()
    const provider = useProvider([
      {
        id: "gpt-default",
        isDefault: true,
        supportedReasoningEfforts: [{ reasoningEffort: "high" }],
      },
    ])
    const generation = await acquireReservedGeneration("high")
    if (!generation) throw new Error("Expected a connected generation")

    await expect(
      collect(
        generation.wrapStream(
          streamOf(
            { type: "text-delta", text: "safe" },
            { type: "tool-call", toolName: "shell", input: "secret" },
          ),
        ),
      ),
    ).rejects.toMatchObject({
      name: "OpenAiCodexError",
      code: "tool-blocked",
    })
    await generation.release()

    expect(provider.close).toHaveBeenCalledOnce()
    expect(mocks.reapCodexProcessGroup).toHaveBeenCalledOnce()
    expect(mocks.removeCodexHome).toHaveBeenCalledOnce()
    expect(mocks.releaseProcess).toHaveBeenCalledOnce()
    expect(connection.credentials.every((byte) => byte === 0)).toBe(true)
  })

  it("replaces upstream stream errors with safe application errors", async () => {
    useConnection()
    const generation = await acquireReservedGeneration("high")
    if (!generation) throw new Error("Expected a connected generation")

    const parts = await collect(
      generation.wrapStream(
        streamOf({
          type: "error",
          error: new Error("status 401: bearer stream-auth-secret"),
        }),
      ),
    )

    expect(parts).toHaveLength(1)
    expect(parts[0]).toMatchObject({
      type: "error",
      error: {
        name: "OpenAiCodexError",
        code: "authentication-required",
      },
    })
    expect(JSON.stringify(parts)).not.toContain("stream-auth-secret")
  })

  it("refreshes only through CAS after reaping, clears buffers, and is idempotent", async () => {
    const connection = useConnection()
    const refreshed = Buffer.from("rotated-credentials")
    const casSnapshots: Buffer[] = []
    mocks.readCodexCredentials.mockResolvedValue(refreshed)
    mocks.compareAndSwapOpenAiCodexCredentials.mockImplementation(
      (_snapshot: Connection, credentials: Buffer) => {
        casSnapshots.push(Buffer.from(credentials))
        // A deleted or replaced row produces no update. The generation must not
        // recreate it through an unconditional write.
        return false
      },
    )
    const provider = useProvider([
      {
        id: "gpt-default",
        isDefault: true,
        supportedReasoningEfforts: [{ reasoningEffort: "high" }],
      },
    ])
    const generation = await acquireReservedGeneration("high")
    if (!generation) throw new Error("Expected a connected generation")

    await generation.release()
    await generation.release()

    const closeOrder = provider.close.mock.invocationCallOrder[0]
    const reapOrder = mocks.reapCodexProcessGroup.mock.invocationCallOrder[0]
    const readOrder = mocks.readCodexCredentials.mock.invocationCallOrder[0]
    const casOrder =
      mocks.compareAndSwapOpenAiCodexCredentials.mock.invocationCallOrder[0]
    expect(closeOrder).toBeLessThan(reapOrder)
    expect(reapOrder).toBeLessThan(readOrder)
    expect(readOrder).toBeLessThan(casOrder)
    expect(
      mocks.compareAndSwapOpenAiCodexCredentials,
    ).toHaveBeenCalledExactlyOnceWith(connection, refreshed)
    expect(casSnapshots).toEqual([Buffer.from("rotated-credentials")])
    expect(provider.close).toHaveBeenCalledOnce()
    expect(mocks.releaseProcess).toHaveBeenCalledOnce()
    expect(connection.credentials.every((byte) => byte === 0)).toBe(true)
    expect(refreshed.every((byte) => byte === 0)).toBe(true)
    expect(mocks.homeCredentialSnapshots).toEqual([
      Buffer.from("initial-credentials"),
    ])
  })

  it("still reaps and removes the credential home when provider close fails", async () => {
    useConnection()
    const provider = useProvider([
      {
        id: "gpt-default",
        isDefault: true,
        supportedReasoningEfforts: [{ reasoningEffort: "high" }],
      },
    ])
    provider.close.mockRejectedValue(new Error("close failed with secret"))
    const generation = await acquireReservedGeneration("high")
    if (!generation) throw new Error("Expected a connected generation")

    await expect(generation.release()).rejects.toMatchObject({
      name: "OpenAiCodexError",
      code: "temporarily-unavailable",
    })

    expect(mocks.reapCodexProcessGroup).toHaveBeenCalledWith(fakeHome)
    expect(mocks.readCodexCredentials).toHaveBeenCalledWith(fakeHome)
    expect(mocks.removeCodexHome).toHaveBeenCalledWith(fakeHome)
    expect(mocks.releaseProcess).toHaveBeenCalledOnce()
  })

  it("requests fatal containment and retains process capacity when credential-home deletion fails", async () => {
    const connection = useConnection()
    const refreshed = Buffer.from("rotated-credentials")
    mocks.readCodexCredentials.mockResolvedValue(refreshed)
    mocks.removeCodexHome.mockRejectedValue(new Error("deletion failed"))
    const generation = await acquireReservedGeneration("high")
    if (!generation) throw new Error("Expected a connected generation")

    const firstRelease = generation.release()
    const secondRelease = generation.release()

    await expect(firstRelease).rejects.toBeInstanceOf(
      mocks.FatalCodexContainmentError,
    )
    await expect(secondRelease).rejects.toBeInstanceOf(
      mocks.FatalCodexContainmentError,
    )
    expect(mocks.terminateApiForUnreapedCodexProcess).toHaveBeenCalledOnce()
    expect(mocks.removeCodexHome).toHaveBeenCalledExactlyOnceWith(fakeHome)
    expect(mocks.releaseProcess).not.toHaveBeenCalled()
    expect(connection.credentials.every((byte) => byte === 0)).toBe(true)
    expect(refreshed.every((byte) => byte === 0)).toBe(true)
  })

  it("requests fatal containment and retains all state when reaping fails", async () => {
    useConnection()
    mocks.reapCodexProcessGroup.mockRejectedValue(new Error("group survived"))
    const generation = await acquireReservedGeneration("high")
    if (!generation) throw new Error("Expected a connected generation")

    await expect(generation.release()).rejects.toBeInstanceOf(
      mocks.FatalCodexContainmentError,
    )

    expect(mocks.terminateApiForUnreapedCodexProcess).toHaveBeenCalledOnce()
    expect(mocks.readCodexCredentials).not.toHaveBeenCalled()
    expect(mocks.compareAndSwapOpenAiCodexCredentials).not.toHaveBeenCalled()
    expect(mocks.removeCodexHome).not.toHaveBeenCalled()
    expect(mocks.releaseProcess).not.toHaveBeenCalled()
  })
})
