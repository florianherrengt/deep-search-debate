import { PassThrough } from "node:stream"
import { beforeEach, describe, expect, it, vi } from "vitest"

const mocks = vi.hoisted(() => ({
  reapCodexProcessGroup: vi.fn(),
  terminateApiForUnreapedCodexProcess: vi.fn(),
}))

vi.mock("./codexSession/process.ts", async (importOriginal) => {
  const actual = await importOriginal<
    typeof import("./codexSession/process.ts")
  >()
  return {
    ...actual,
    reapCodexProcessGroup: mocks.reapCodexProcessGroup,
    terminateApiForUnreapedCodexProcess:
      mocks.terminateApiForUnreapedCodexProcess,
  }
})

import type { CodexHome } from "./codexSession/home.ts"
import { FatalCodexContainmentError } from "./codexSession/process.ts"
import { accountReadSchema, CodexRpcClient } from "./codexRpcClient.ts"

const fakeHome: CodexHome = {
  root: "/tmp/rethinkloop-codex-rpc-test",
  home: "/tmp/rethinkloop-codex-rpc-test/home",
  work: "/tmp/rethinkloop-codex-rpc-test/work",
  control: "/tmp/rethinkloop-codex-rpc-test/control",
  rootIdentity: { dev: 1n, ino: 2n },
}

function attachChild(client: CodexRpcClient): ReturnType<typeof vi.fn> {
  const kill = vi.fn(() => {
    throw new Error("graceful close failed")
  })
  const stream = new PassThrough()
  ;(
    client as unknown as {
      child: {
        kill: typeof kill
        stdin: PassThrough
        stdout: PassThrough
        stderr: PassThrough
      }
    }
  ).child = { kill, stdin: stream, stdout: stream, stderr: stream }
  return kill
}

beforeEach(() => {
  vi.clearAllMocks()
  mocks.reapCodexProcessGroup.mockResolvedValue(undefined)
  mocks.terminateApiForUnreapedCodexProcess.mockImplementation(() => {
    throw new FatalCodexContainmentError()
  })
})

describe("Codex RPC schemas", () => {
  it("retains only the account type needed to verify ChatGPT authentication", () => {
    expect(
      accountReadSchema.parse({
        account: {
          type: "chatgpt",
          email: "person@example.com",
          planType: "plus",
        },
        requiresOpenaiAuth: false,
      }),
    ).toEqual({ account: { type: "chatgpt" } })
    expect(accountReadSchema.parse({ account: null })).toEqual({
      account: null,
    })
  })
})

describe("Codex RPC client shutdown", () => {
  it("shares one close promise and waits for one authoritative reap", async () => {
    const reap = Promise.withResolvers<void>()
    mocks.reapCodexProcessGroup.mockReturnValue(reap.promise)
    const client = new CodexRpcClient(fakeHome)
    const kill = attachChild(client)

    const first = client.close()
    const second = client.close()

    expect(second).toBe(first)
    expect(kill).toHaveBeenCalledOnce()
    expect(mocks.reapCodexProcessGroup).toHaveBeenCalledOnce()

    let settled = false
    void second.then(() => {
      settled = true
    })
    await Promise.resolve()
    expect(settled).toBe(false)

    reap.resolve()
    await expect(Promise.all([first, second])).resolves.toEqual([
      undefined,
      undefined,
    ])
  })

  it("requests fatal API containment when group exit cannot be proven", async () => {
    mocks.reapCodexProcessGroup.mockRejectedValue(new Error("still live"))
    const client = new CodexRpcClient(fakeHome)
    attachChild(client)

    await expect(client.close()).rejects.toBeInstanceOf(
      FatalCodexContainmentError,
    )
    expect(mocks.terminateApiForUnreapedCodexProcess).toHaveBeenCalledOnce()
  })
})
