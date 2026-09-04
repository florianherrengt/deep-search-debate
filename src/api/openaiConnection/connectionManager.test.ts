import type {
  AuthInteraction,
  OAuthCredential,
} from "@earendil-works/pi-ai"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

const mocks = vi.hoisted(() => ({
  connectedUsers: new Set<string>(),
  disconnectOpenAiAndResetModelAssignments: vi.fn(),
  hasOpenAiCodexConnection: vi.fn(),
  login: vi.fn(),
  replaceOpenAiCodexConnection: vi.fn(),
  storedCredentials: [] as Buffer[],
  withPiCodexCredentialLock: vi.fn(),
}))

vi.mock("@earendil-works/pi-ai/providers/openai-codex", () => ({
  openaiCodexProvider: () => ({ auth: { oauth: { login: mocks.login } } }),
}))

vi.mock("./credentialsRepository.ts", () => ({
  hasOpenAiCodexConnection: mocks.hasOpenAiCodexConnection,
  replaceOpenAiCodexConnection: mocks.replaceOpenAiCodexConnection,
}))

vi.mock("../llms/modelSettings.ts", () => ({
  disconnectOpenAiAndResetModelAssignments:
    mocks.disconnectOpenAiAndResetModelAssignments,
}))

vi.mock("./piCredentials.ts", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./piCredentials.ts")>()
  return {
    ...actual,
    withPiCodexCredentialLock: mocks.withPiCodexCredentialLock,
  }
})

import {
  closeOpenAiConnectionOperations,
  disconnectOpenAiConnection,
  getOpenAiConnectionSnapshot,
  startOpenAiConnection,
} from "./connectionManager.ts"

const credential: OAuthCredential = {
  type: "oauth",
  access: "access-token",
  refresh: "refresh-token",
  expires: Date.now() + 3_600_000,
  accountId: "account-1",
}
const usersUsed = new Set<string>()

function useUser(userId: string): string {
  usersUsed.add(userId)
  return userId
}

function pendingLogin() {
  const completed = Promise.withResolvers<OAuthCredential>()
  let interaction: AuthInteraction | undefined
  mocks.login.mockImplementation(async (value: AuthInteraction) => {
    interaction = value
    expect(
      await value.prompt({
        type: "select",
        message: "method",
        options: [
          { id: "browser", label: "Browser" },
          { id: "device_code", label: "Device" },
        ],
      }),
    ).toBe("device_code")
    value.notify({
      type: "device_code",
      userCode: "ABCD-EFGH",
      verificationUri: "https://auth.openai.com/device",
      expiresInSeconds: 900,
    })
    const aborted = new Promise<never>((_resolve, reject) => {
      const rejectOnAbort = () =>
        reject(new DOMException("Aborted", "AbortError"))
      if (value.signal?.aborted) rejectOnAbort()
      else value.signal?.addEventListener("abort", rejectOnAbort, {
        once: true,
      })
    })
    return Promise.race([completed.promise, aborted])
  })
  return {
    completed,
    get interaction() {
      return interaction
    },
  }
}

beforeEach(() => {
  vi.clearAllMocks()
  mocks.connectedUsers.clear()
  mocks.storedCredentials.length = 0
  mocks.hasOpenAiCodexConnection.mockImplementation((userId: string) =>
    mocks.connectedUsers.has(userId),
  )
  mocks.replaceOpenAiCodexConnection.mockImplementation(
    (userId: string, value: Buffer) => {
      mocks.connectedUsers.add(userId)
      mocks.storedCredentials.push(Buffer.from(value))
    },
  )
  mocks.disconnectOpenAiAndResetModelAssignments.mockImplementation(
    (userId: string) => mocks.connectedUsers.delete(userId),
  )
  mocks.withPiCodexCredentialLock.mockImplementation(
    (_userId: string, operation: () => unknown) =>
      Promise.resolve(operation()),
  )
})

afterEach(async () => {
  await closeOpenAiConnectionOperations()
  await Promise.all(
    [...usersUsed].map((userId) => disconnectOpenAiConnection(userId)),
  )
  usersUsed.clear()
})

describe("OpenAI connection state machine", () => {
  it("starts Pi device-code login and exposes pending instructions", async () => {
    const login = pendingLogin()
    const userId = useUser("pending-user")

    const snapshot = await startOpenAiConnection(userId)

    expect(snapshot).toMatchObject({
      status: "pending",
      verificationUrl: "https://auth.openai.com/device",
      userCode: "ABCD-EFGH",
    })
    expect(snapshot).toHaveProperty("expiresAt")
    expect(getOpenAiConnectionSnapshot(userId)).toEqual(snapshot)
    expect(login.interaction?.signal?.aborted).toBe(false)
  })

  it("rejects malformed or non-HTTPS device URLs with a safe failure", async () => {
    mocks.login.mockImplementation((interaction: AuthInteraction) => {
      interaction.notify({
        type: "device_code",
        userCode: "ABCD-EFGH",
        verificationUri: "http://openai.test/device",
      })
      return Promise.resolve(credential)
    })

    await expect(
      startOpenAiConnection(useUser("invalid-url-user")),
    ).resolves.toEqual({
      status: "failed",
      message:
        "This OpenAI connection is not compatible with the current Codex integration. Try connecting again later.",
    })
    expect(mocks.replaceOpenAiCodexConnection).not.toHaveBeenCalled()
  })

  it("rejects another user's login while one device flow is active", async () => {
    pendingLogin()
    await startOpenAiConnection(useUser("first-user"))

    await expect(
      startOpenAiConnection(useUser("second-user")),
    ).rejects.toMatchObject({ status: 429 })
    expect(mocks.login).toHaveBeenCalledOnce()
  })

  it("stores the completed Pi OAuth credential and becomes connected", async () => {
    const login = pendingLogin()
    const userId = useUser("completed-user")
    await startOpenAiConnection(userId)

    login.completed.resolve(credential)

    await vi.waitFor(() => {
      expect(getOpenAiConnectionSnapshot(userId)).toEqual({
        status: "connected",
      })
    })
    expect(JSON.parse(mocks.storedCredentials[0]?.toString("utf8") ?? "")).toEqual(
      credential,
    )
    expect(mocks.withPiCodexCredentialLock).toHaveBeenCalledWith(
      userId,
      expect.any(Function),
    )
  })

  it("sanitizes an upstream login failure", async () => {
    mocks.login.mockRejectedValue(
      new Error("status 429: upstream-secret-should-never-escape"),
    )

    const snapshot = await startOpenAiConnection(useUser("failed-user"))

    expect(snapshot).toEqual({
      status: "failed",
      message:
        "Your OpenAI subscription is temporarily rate-limited. Try again after its usage limit resets.",
    })
    expect(JSON.stringify(snapshot)).not.toContain("upstream-secret")
  })

  it("times out a login whose initial Pi request never returns", async () => {
    vi.useFakeTimers()
    mocks.login.mockImplementation(
      (interaction: AuthInteraction) =>
        new Promise<OAuthCredential>((_resolve, reject) => {
          const onAbort = () => {
            reject(new DOMException("Aborted", "AbortError"))
          }
          if (interaction.signal?.aborted) onAbort()
          else interaction.signal?.addEventListener("abort", onAbort, {
            once: true,
          })
        }),
    )
    const userId = useUser("timed-out-user")
    const starting = startOpenAiConnection(userId)

    await vi.advanceTimersByTimeAsync(15 * 60 * 1_000)

    await expect(starting).resolves.toEqual({
      status: "failed",
      message: "OpenAI Codex timed out. Try again.",
    })
    expect(getOpenAiConnectionSnapshot(userId)).toEqual({
      status: "failed",
      message: "OpenAI Codex timed out. Try again.",
    })
  })

  it("aborts a pending flow and prevents a late credential write", async () => {
    const login = pendingLogin()
    const userId = useUser("cancelled-user")
    await startOpenAiConnection(userId)
    const disconnecting = disconnectOpenAiConnection(userId)
    login.completed.reject(new DOMException("Aborted", "AbortError"))

    await expect(disconnecting).resolves.toEqual({ status: "disconnected" })
    expect(login.interaction?.signal?.aborted).toBe(true)
    expect(mocks.replaceOpenAiCodexConnection).not.toHaveBeenCalled()
    expect(mocks.disconnectOpenAiAndResetModelAssignments).toHaveBeenCalledWith(
      userId,
    )
  })
})
