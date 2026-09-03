import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

type NotificationHandler = (params: unknown) => void | Promise<void>

type FakeRpcClient = {
  close: ReturnType<typeof vi.fn>
  emit(method: string, params: unknown): void
  request: ReturnType<typeof vi.fn>
  start: ReturnType<typeof vi.fn>
}

const mocks = vi.hoisted(() => ({
  FatalCodexContainmentError: class FatalCodexContainmentError extends Error {},
  acquireCodexLoginProcess: vi.fn(),
  connectedUsers: new Set<string>(),
  createCodexHome: vi.fn(),
  disconnectOpenAiAndResetModelAssignments: vi.fn(),
  hasOpenAiCodexConnection: vi.fn(),
  instances: [] as FakeRpcClient[],
  readCodexCredentials: vi.fn(),
  release: vi.fn(),
  removeCodexHome: vi.fn(),
  replaceOpenAiCodexConnection: vi.fn(),
  requestImplementation: vi.fn<
    (
      client: FakeRpcClient,
      method: string,
      params: unknown,
      schema: unknown,
    ) => unknown
  >(),
  startImplementation: vi.fn<(client: FakeRpcClient) => unknown>(),
  storedCredentials: [] as Buffer[],
  terminateApiForUnreapedCodexProcess: vi.fn(),
}))

vi.mock("./credentialsRepository.ts", () => ({
  hasOpenAiCodexConnection: mocks.hasOpenAiCodexConnection,
  replaceOpenAiCodexConnection: mocks.replaceOpenAiCodexConnection,
}))

vi.mock("../llms/modelSettings.ts", () => ({
  disconnectOpenAiAndResetModelAssignments:
    mocks.disconnectOpenAiAndResetModelAssignments,
}))

vi.mock("./codexSession/home.ts", () => ({
  createCodexHome: mocks.createCodexHome,
  readCodexCredentials: mocks.readCodexCredentials,
  removeCodexHome: mocks.removeCodexHome,
}))

vi.mock("./codexSession/process.ts", () => ({
  FatalCodexContainmentError: mocks.FatalCodexContainmentError,
  terminateApiForUnreapedCodexProcess:
    mocks.terminateApiForUnreapedCodexProcess,
}))

vi.mock("./codexProcessSlots.ts", () => ({
  acquireCodexLoginProcess: mocks.acquireCodexLoginProcess,
}))

vi.mock("./codexRpcClient.ts", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./codexRpcClient.ts")>()

  class MockCodexRpcClient implements FakeRpcClient {
    private readonly handlers = new Map<string, Set<NotificationHandler>>()

    readonly start = vi.fn(async (): Promise<void> => {
      await mocks.startImplementation(this)
    })
    readonly close = vi.fn(() => Promise.resolve())
    readonly request = vi.fn(
      (method: string, params: unknown, schema: unknown): Promise<unknown> =>
        Promise.resolve(
          mocks.requestImplementation(this, method, params, schema),
        ),
    )

    constructor() {
      mocks.instances.push(this)
    }

    on(method: string, handler: NotificationHandler): () => void {
      const handlers = this.handlers.get(method) ?? new Set()
      handlers.add(handler)
      this.handlers.set(method, handlers)
      return () => handlers.delete(handler)
    }

    emit(method: string, params: unknown): void {
      for (const handler of this.handlers.get(method) ?? []) {
        void handler(params)
      }
    }
  }

  return { ...actual, CodexRpcClient: MockCodexRpcClient }
})

import {
  closeOpenAiConnectionProcesses,
  disconnectOpenAiConnection,
  getOpenAiConnectionSnapshot,
  startOpenAiConnection,
} from "./connectionManager.ts"
import { deviceLoginResultSchema } from "./codexRpcClient.ts"

const usersUsed = new Set<string>()
const fakeHome = {
  root: "/tmp/rethinkloop-codex-test",
  home: "/tmp/rethinkloop-codex-test/home",
  work: "/tmp/rethinkloop-codex-test/work",
  control: "/tmp/rethinkloop-codex-test/control",
  rootIdentity: { dev: 1n, ino: 2n },
}
const deviceLogin = {
  type: "chatgptDeviceCode" as const,
  loginId: "login-1",
  verificationUrl: "https://auth.openai.com/device",
  userCode: "ABCD-EFGH",
}

function useUser(userId: string): string {
  usersUsed.add(userId)
  return userId
}

function latestClient(): FakeRpcClient {
  const instance = mocks.instances.at(-1)
  if (!instance) throw new Error("Expected the Codex RPC client to start")
  return instance
}

function completeLogin(
  client: FakeRpcClient,
  overrides: Partial<{
    loginId: string | null
    success: boolean
    error: string | null
  }> = {},
): void {
  client.emit("account/login/completed", {
    loginId: deviceLogin.loginId,
    success: true,
    error: null,
    ...overrides,
  })
}

beforeEach(() => {
  vi.clearAllMocks()
  mocks.connectedUsers.clear()
  mocks.instances.length = 0
  mocks.storedCredentials.length = 0
  mocks.acquireCodexLoginProcess.mockReturnValue(mocks.release)
  mocks.createCodexHome.mockResolvedValue(fakeHome)
  mocks.removeCodexHome.mockResolvedValue(undefined)
  mocks.startImplementation.mockReturnValue(undefined)
  mocks.terminateApiForUnreapedCodexProcess.mockImplementation(() => {
    throw new mocks.FatalCodexContainmentError()
  })
  mocks.readCodexCredentials.mockResolvedValue(
    Buffer.from('{"tokens":{"access":"test-access-token"}}'),
  )
  mocks.hasOpenAiCodexConnection.mockImplementation((userId: string) =>
    mocks.connectedUsers.has(userId),
  )
  mocks.replaceOpenAiCodexConnection.mockImplementation(
    (userId: string, credentials: Buffer) => {
      mocks.connectedUsers.add(userId)
      mocks.storedCredentials.push(Buffer.from(credentials))
    },
  )
  mocks.disconnectOpenAiAndResetModelAssignments.mockImplementation(
    (userId: string) => mocks.connectedUsers.delete(userId),
  )
  mocks.requestImplementation.mockImplementation(
    (_client: FakeRpcClient, method: string) => {
      if (method === "account/login/start") return deviceLogin
      if (method === "account/read") {
        return {
          account: { type: "chatgpt" },
        }
      }
      if (method === "account/login/cancel") return {}
      throw new Error(`Unexpected RPC method: ${method}`)
    },
  )
})

afterEach(async () => {
  await closeOpenAiConnectionProcesses()
  await Promise.all(
    [...usersUsed].map((userId) => disconnectOpenAiConnection(userId)),
  )
  usersUsed.clear()
})

describe("OpenAI connection state machine", () => {
  it("rejects malformed or non-HTTPS verification URLs without throwing", () => {
    for (const verificationUrl of ["not a URL", "http://openai.test/device"]) {
      expect(
        deviceLoginResultSchema.safeParse({
          ...deviceLogin,
          verificationUrl,
        }).success,
      ).toBe(false)
    }
  })

  it("starts device-code login and exposes the pending instructions", async () => {
    const userId = useUser("pending-user")

    const snapshot = await startOpenAiConnection(userId)

    expect(snapshot).toMatchObject({
      status: "pending",
      verificationUrl: deviceLogin.verificationUrl,
      userCode: deviceLogin.userCode,
    })
    expect(snapshot).toHaveProperty("expiresAt")
    expect(getOpenAiConnectionSnapshot(userId)).toEqual(snapshot)
    expect(getOpenAiConnectionSnapshot(useUser("other-pending-user"))).toEqual({
      status: "disconnected",
    })
    expect(mocks.acquireCodexLoginProcess).toHaveBeenCalledWith()
    expect(latestClient().request).toHaveBeenCalledWith(
      "account/login/start",
      { type: "chatgptDeviceCode" },
      expect.anything(),
    )
  })

  it("rejects another login immediately when login capacity is occupied", async () => {
    mocks.acquireCodexLoginProcess.mockReturnValueOnce(undefined)

    await expect(
      startOpenAiConnection(useUser("login-capacity-user")),
    ).rejects.toMatchObject({ status: 429 })

    expect(mocks.createCodexHome).not.toHaveBeenCalled()
    expect(mocks.instances).toHaveLength(0)
  })

  it("stores completed ChatGPT authentication and becomes connected", async () => {
    const userId = useUser("completed-user")
    await startOpenAiConnection(userId)

    completeLogin(latestClient())

    await vi.waitFor(() => {
      expect(getOpenAiConnectionSnapshot(userId)).toEqual({
        status: "connected",
      })
    })
    expect(mocks.storedCredentials).toEqual([
      Buffer.from('{"tokens":{"access":"test-access-token"}}'),
    ])
    expect(latestClient().request).toHaveBeenCalledWith(
      "account/read",
      { refreshToken: false },
      expect.anything(),
    )
    expect(latestClient().close).toHaveBeenCalledOnce()
    expect(mocks.removeCodexHome).toHaveBeenCalledWith(fakeHome)
    expect(mocks.release).toHaveBeenCalledOnce()
  })

  it("rejects a completed login that is not a ChatGPT account", async () => {
    const userId = useUser("non-chatgpt-user")
    mocks.requestImplementation.mockImplementation(
      (_client: FakeRpcClient, method: string) => {
        if (method === "account/login/start") return deviceLogin
        if (method === "account/read") {
          return { account: { type: "apiKey" } }
        }
        throw new Error(`Unexpected RPC method: ${method}`)
      },
    )
    await startOpenAiConnection(userId)

    completeLogin(latestClient())

    await vi.waitFor(() => {
      expect(getOpenAiConnectionSnapshot(userId)).toEqual({
        status: "failed",
        message:
          "Your OpenAI connection has expired. Disconnect it and connect again.",
      })
    })
    expect(mocks.replaceOpenAiCodexConnection).not.toHaveBeenCalled()
  })

  it("cancels a pending login and directly removes any stored connection", async () => {
    const userId = useUser("cancelled-user")
    await startOpenAiConnection(userId)

    await expect(disconnectOpenAiConnection(userId)).resolves.toEqual({
      status: "disconnected",
    })

    expect(latestClient().request).toHaveBeenCalledWith(
      "account/login/cancel",
      { loginId: deviceLogin.loginId },
      expect.anything(),
    )
    expect(mocks.replaceOpenAiCodexConnection).not.toHaveBeenCalled()
    expect(mocks.disconnectOpenAiAndResetModelAssignments).toHaveBeenCalledWith(
      userId,
    )
    expect(getOpenAiConnectionSnapshot(userId)).toEqual({
      status: "disconnected",
    })
  })

  it("does not create a connection when disconnect races login startup", async () => {
    const userId = useUser("startup-race-user")
    const login = Promise.withResolvers<typeof deviceLogin>()
    mocks.requestImplementation.mockImplementation(
      (_client: FakeRpcClient, method: string) => {
        if (method === "account/login/start") return login.promise
        if (method === "account/login/cancel") return {}
        throw new Error(`Unexpected RPC method: ${method}`)
      },
    )

    const starting = startOpenAiConnection(userId)
    await vi.waitFor(() => expect(mocks.instances).toHaveLength(1))
    await expect(disconnectOpenAiConnection(userId)).resolves.toEqual({
      status: "disconnected",
    })
    login.resolve(deviceLogin)

    await expect(starting).resolves.toEqual({ status: "disconnected" })
    expect(latestClient().request).toHaveBeenCalledWith(
      "account/login/cancel",
      { loginId: deviceLogin.loginId },
      expect.anything(),
    )
    expect(mocks.replaceOpenAiCodexConnection).not.toHaveBeenCalled()
    expect(mocks.release).toHaveBeenCalledOnce()
  })

  it("terminates and retains login capacity when startup-race cleanup fails", async () => {
    const userId = useUser("startup-race-cleanup-user")
    const login = Promise.withResolvers<typeof deviceLogin>()
    mocks.requestImplementation.mockImplementation(
      (_client: FakeRpcClient, method: string) => {
        if (method === "account/login/start") return login.promise
        if (method === "account/login/cancel") return {}
        throw new Error(`Unexpected RPC method: ${method}`)
      },
    )
    mocks.removeCodexHome.mockRejectedValue(new Error("deletion failed"))

    const starting = startOpenAiConnection(userId)
    await vi.waitFor(() => expect(mocks.instances).toHaveLength(1))
    await expect(disconnectOpenAiConnection(userId)).resolves.toEqual({
      status: "disconnected",
    })
    login.resolve(deviceLogin)

    await expect(starting).rejects.toBeInstanceOf(
      mocks.FatalCodexContainmentError,
    )
    expect(mocks.terminateApiForUnreapedCodexProcess).toHaveBeenCalledOnce()
    expect(mocks.release).not.toHaveBeenCalled()
  })

  it("terminates and retains login capacity when startup-error cleanup fails", async () => {
    const userId = useUser("startup-error-cleanup-user")
    mocks.startImplementation.mockRejectedValue(new Error("startup failed"))
    mocks.removeCodexHome.mockRejectedValue(new Error("deletion failed"))

    await expect(startOpenAiConnection(userId)).rejects.toBeInstanceOf(
      mocks.FatalCodexContainmentError,
    )
    expect(mocks.terminateApiForUnreapedCodexProcess).toHaveBeenCalledOnce()
    expect(mocks.release).not.toHaveBeenCalled()
  })

  it("terminates and retains pending state when completed-login cleanup fails", async () => {
    const userId = useUser("completed-cleanup-user")
    await startOpenAiConnection(userId)
    mocks.removeCodexHome.mockRejectedValue(new Error("deletion failed"))

    completeLogin(latestClient())

    await vi.waitFor(() => {
      expect(mocks.terminateApiForUnreapedCodexProcess).toHaveBeenCalledOnce()
    })
    usersUsed.delete(userId)
    expect(latestClient().request).toHaveBeenCalledWith(
      "account/read",
      { refreshToken: false },
      expect.anything(),
    )
    expect(mocks.replaceOpenAiCodexConnection).toHaveBeenCalledOnce()
    expect(mocks.release).not.toHaveBeenCalled()
    mocks.connectedUsers.delete(userId)
    expect(getOpenAiConnectionSnapshot(userId)).toMatchObject({
      status: "pending",
    })
  })

  it("reports an upstream failure using only a safe application message", async () => {
    const userId = useUser("failed-user")
    await startOpenAiConnection(userId)

    completeLogin(latestClient(), {
      success: false,
      error: "rate limit: upstream-secret-should-never-escape",
    })

    await vi.waitFor(() => {
      expect(getOpenAiConnectionSnapshot(userId)).toEqual({
        status: "failed",
        message:
          "Your OpenAI subscription is temporarily rate-limited. Try again after its usage limit resets.",
      })
    })
    expect(JSON.stringify(getOpenAiConnectionSnapshot(userId))).not.toContain(
      "upstream-secret",
    )
    expect(mocks.replaceOpenAiCodexConnection).not.toHaveBeenCalled()
  })

  it("reports device-login expiry as a timeout rather than cancellation", async () => {
    vi.useFakeTimers()
    try {
      const userId = useUser("expired-user")
      await startOpenAiConnection(userId)

      await vi.advanceTimersByTimeAsync(15 * 60 * 1_000)

      expect(getOpenAiConnectionSnapshot(userId)).toEqual({
        status: "failed",
        message: "OpenAI Codex timed out. Try again.",
      })
      expect(mocks.replaceOpenAiCodexConnection).not.toHaveBeenCalled()
      expect(latestClient().close).toHaveBeenCalledOnce()
      expect(mocks.removeCodexHome).toHaveBeenCalledWith(fakeHome)
      expect(mocks.release).toHaveBeenCalledOnce()
    } finally {
      vi.useRealTimers()
    }
  })

  it("handles completion emitted before the login-start response", async () => {
    const userId = useUser("early-completion-user")
    mocks.requestImplementation.mockImplementation(
      (client: FakeRpcClient, method: string) => {
        if (method === "account/login/start") {
          completeLogin(client)
          return deviceLogin
        }
        if (method === "account/read") {
          return { account: { type: "chatgpt" } }
        }
        throw new Error(`Unexpected RPC method: ${method}`)
      },
    )

    const initialSnapshot = await startOpenAiConnection(userId)

    expect(initialSnapshot.status).toBe("pending")
    await vi.waitFor(() => {
      expect(getOpenAiConnectionSnapshot(userId)).toEqual({
        status: "connected",
      })
    })
    expect(mocks.replaceOpenAiCodexConnection).toHaveBeenCalledOnce()
    expect(mocks.release).toHaveBeenCalledOnce()
  })

  it("does not persist or clean up a login when process exit is unproven", async () => {
    const userId = useUser("fatal-reaper-user")
    await startOpenAiConnection(userId)
    latestClient().close.mockRejectedValue(
      new mocks.FatalCodexContainmentError(),
    )

    await expect(disconnectOpenAiConnection(userId)).rejects.toBeInstanceOf(
      mocks.FatalCodexContainmentError,
    )

    expect(mocks.replaceOpenAiCodexConnection).not.toHaveBeenCalled()
    expect(mocks.readCodexCredentials).not.toHaveBeenCalled()
    expect(mocks.removeCodexHome).not.toHaveBeenCalled()
    expect(mocks.release).not.toHaveBeenCalled()
    expect(mocks.disconnectOpenAiAndResetModelAssignments).not.toHaveBeenCalled()
    usersUsed.delete(userId)
  })
})
