import type { OAuthCredential } from "@earendil-works/pi-ai"
import { beforeEach, describe, expect, it, vi } from "vitest"

const mocks = vi.hoisted(() => ({
  compareAndSwap: vi.fn(),
  deleteConnection: vi.fn(),
  getConnection: vi.fn(),
  hasConnection: vi.fn(),
  replaceConnection: vi.fn(),
}))

vi.mock("./credentialsRepository.ts", () => ({
  compareAndSwapOpenAiCodexCredentials: mocks.compareAndSwap,
  deleteOpenAiCodexConnectionForUser: mocks.deleteConnection,
  getOpenAiCodexConnection: mocks.getConnection,
  hasOpenAiCodexConnection: mocks.hasConnection,
  replaceOpenAiCodexConnection: mocks.replaceConnection,
}))

import {
  encodePiCodexCredential,
  PI_CODEX_PROVIDER_ID,
  PiCodexCredentialStore,
  withPiCodexCredentialLock,
} from "./piCredentials.ts"

const first: OAuthCredential = {
  type: "oauth",
  access: "access-one",
  refresh: "refresh-one",
  expires: 1_900_000_000_000,
  accountId: "account-one",
}
const second: OAuthCredential = {
  ...first,
  access: "access-two",
  refresh: "refresh-two",
}

function snapshot(credential: OAuthCredential) {
  return {
    userId: "user-1",
    connectionId: "connection-1",
    credentials: encodePiCodexCredential(credential),
  }
}

beforeEach(() => {
  vi.clearAllMocks()
  mocks.getConnection.mockReturnValue(undefined)
  mocks.hasConnection.mockReturnValue(false)
})

describe("Pi Codex credential persistence", () => {
  it("reads legacy Codex auth-file credentials without rewriting the connection", async () => {
    const payload = Buffer.from(JSON.stringify({ exp: 1_900_000_000 }))
      .toString("base64url")
    const access = `test.${payload}.signature`
    const stored = {
      userId: "user-1",
      connectionId: "connection-1",
      credentials: Buffer.from(JSON.stringify({
        auth_mode: "chatgpt",
        tokens: {
          access_token: access,
          refresh_token: "legacy-refresh",
          account_id: "legacy-account",
        },
        last_refresh: "2026-09-04T12:00:00Z",
      })),
    }
    mocks.getConnection.mockReturnValue(stored)
    const store = new PiCodexCredentialStore("user-1")

    await expect(store.read(PI_CODEX_PROVIDER_ID)).resolves.toEqual({
      type: "oauth",
      access,
      refresh: "legacy-refresh",
      expires: 1_900_000_000_000,
      accountId: "legacy-account",
    })
    expect(mocks.replaceConnection).not.toHaveBeenCalled()
    expect(mocks.compareAndSwap).not.toHaveBeenCalled()
    expect(stored.credentials.every((byte) => byte === 0)).toBe(true)
  })

  it("reads and lists the existing encrypted-row payload", async () => {
    const stored = snapshot(first)
    mocks.getConnection.mockReturnValue(stored)
    mocks.hasConnection.mockReturnValue(true)
    const store = new PiCodexCredentialStore("user-1")

    await expect(store.read(PI_CODEX_PROVIDER_ID)).resolves.toEqual(first)
    await expect(store.list()).resolves.toEqual([
      { providerId: PI_CODEX_PROVIDER_ID, type: "oauth" },
    ])
    expect(stored.credentials.every((byte) => byte === 0)).toBe(true)
  })

  it("inserts a newly issued OAuth credential and clears the plaintext buffer", async () => {
    const store = new PiCodexCredentialStore("user-1")
    let persisted: Buffer | undefined
    mocks.getConnection.mockReturnValue(undefined)
    mocks.replaceConnection.mockImplementation(
      (_userId: string, credentials: Buffer) => {
        persisted = Buffer.from(credentials)
        expect(credentials.some((byte) => byte !== 0)).toBe(true)
      },
    )

    await expect(
      store.modify(PI_CODEX_PROVIDER_ID, () => Promise.resolve(first)),
    ).resolves.toEqual(first)
    expect(mocks.replaceConnection).toHaveBeenCalledWith(
      "user-1",
      expect.any(Buffer),
    )
    expect(JSON.parse(persisted?.toString("utf8") ?? "")).toEqual(first)
    const written = mocks.replaceConnection.mock.calls[0]?.[1] as Buffer
    expect(written.every((byte) => byte === 0)).toBe(true)
  })

  it("refreshes an existing credential with compare-and-swap", async () => {
    const stored = snapshot(first)
    mocks.getConnection.mockReturnValue(stored)
    mocks.compareAndSwap.mockReturnValue(true)
    const store = new PiCodexCredentialStore("user-1")

    await expect(
      store.modify(PI_CODEX_PROVIDER_ID, (current) => {
        expect(current).toEqual(first)
        return Promise.resolve(second)
      }),
    ).resolves.toEqual(second)
    expect(mocks.compareAndSwap).toHaveBeenCalledWith(
      expect.objectContaining({ connectionId: "connection-1" }),
      expect.any(Buffer),
    )
  })

  it("returns the current value when a modifier declines to write", async () => {
    mocks.getConnection.mockReturnValue(snapshot(first))
    const store = new PiCodexCredentialStore("user-1")

    await expect(
      store.modify(PI_CODEX_PROVIDER_ID, () => Promise.resolve(undefined)),
    ).resolves.toEqual(first)
    expect(mocks.compareAndSwap).not.toHaveBeenCalled()
  })

  it("deletes only the requested user's credential", async () => {
    const store = new PiCodexCredentialStore("user-1")

    await store.delete(PI_CODEX_PROVIDER_ID)

    expect(mocks.deleteConnection).toHaveBeenCalledExactlyOnceWith("user-1")
  })

  it("rejects unsupported providers and non-OAuth credentials", async () => {
    const store = new PiCodexCredentialStore("user-1")

    expect(() => store.read("other-provider")).toThrow(
      "Unsupported Pi credential provider",
    )
    await expect(
      store.modify(
        PI_CODEX_PROVIDER_ID,
        () => Promise.resolve({ type: "api_key", key: "secret" }),
      ),
    ).rejects.toThrow("requires an OAuth credential")
  })

  it("serializes writes for one user", async () => {
    const firstStarted = Promise.withResolvers<void>()
    const releaseFirst = Promise.withResolvers<void>()
    const order: string[] = []

    const firstOperation = withPiCodexCredentialLock("locked-user", async () => {
      order.push("first-start")
      firstStarted.resolve()
      await releaseFirst.promise
      order.push("first-end")
    })
    await firstStarted.promise
    const secondOperation = withPiCodexCredentialLock("locked-user", () => {
      order.push("second")
    })
    await Promise.resolve()
    expect(order).toEqual(["first-start"])

    releaseFirst.resolve()
    await Promise.all([firstOperation, secondOperation])
    expect(order).toEqual(["first-start", "first-end", "second"])
  })
})
