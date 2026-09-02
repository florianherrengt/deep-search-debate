import { describe, expect, it } from "vitest"
import {
  acquireCodexLoginProcess,
  acquireCodexProcess,
} from "./codexProcessSlots.ts"

describe("Codex process slots", () => {
  it("serializes credential-bearing processes for one user", async () => {
    const first = await acquireCodexProcess("serialized-user")
    expect(first).toBeTypeOf("function")

    const secondPromise = acquireCodexProcess("serialized-user")
    let secondSettled = false
    void secondPromise.then(() => {
      secondSettled = true
    })
    await Promise.resolve()
    expect(secondSettled).toBe(false)

    first()
    const second = await secondPromise
    expect(second).toBeTypeOf("function")
    second()
  })

  it("aborts a same-user waiter without releasing the active process", async () => {
    const first = await acquireCodexProcess("abortable-user")
    const controller = new AbortController()
    const reason = new Error("Stopped while waiting for Codex")
    const waiting = acquireCodexProcess("abortable-user", {
      signal: controller.signal,
    })

    controller.abort(reason)

    await expect(waiting).rejects.toBe(reason)
    first()
    const next = await acquireCodexProcess("abortable-user")
    expect(next).toBeTypeOf("function")
    next()
  })

  it("allows different users to hold independent process leases", async () => {
    const first = await acquireCodexProcess("slot-user-a")
    const second = await acquireCodexProcess("slot-user-b")

    expect(first).toBeTypeOf("function")
    expect(second).toBeTypeOf("function")
    first()
    second()
  })

  it("limits pending logins to one without consuming user process leases", async () => {
    const login = acquireCodexLoginProcess()
    expect(login).toBeTypeOf("function")
    expect(acquireCodexLoginProcess()).toBeUndefined()

    const firstGeneration = await acquireCodexProcess("generation-user-a")
    const secondGeneration = await acquireCodexProcess("generation-user-b")
    expect(firstGeneration).toBeTypeOf("function")
    expect(secondGeneration).toBeTypeOf("function")

    firstGeneration()
    secondGeneration()
    login!()
  })

  it("allows the next login only after the active login releases", () => {
    const first = acquireCodexLoginProcess()
    expect(acquireCodexLoginProcess()).toBeUndefined()

    first!()
    const second = acquireCodexLoginProcess()
    expect(second).toBeTypeOf("function")
    second!()
  })
})
