import { afterEach, describe, expect, it, vi } from "vitest"
import { joinWaitlist } from "./waitlist.ts"

describe("waitlist client", () => {
  afterEach(() => vi.unstubAllGlobals())

  it("normalizes an email before joining the waitlist", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(Response.json({ joined: true }))
    vi.stubGlobal("fetch", fetchMock)

    await expect(joinWaitlist("  Person@Example.COM  ")).resolves.toEqual({
      joined: true,
    })
    expect(fetchMock).toHaveBeenCalledWith("/api/waitlist", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: "person@example.com" }),
      signal: undefined,
    })
  })

  it("rejects invalid input and malformed responses", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(Response.json({ joined: "maybe" }))
    vi.stubGlobal("fetch", fetchMock)

    await expect(joinWaitlist("not an email")).rejects.toThrow()
    expect(fetchMock).not.toHaveBeenCalled()

    await expect(joinWaitlist("person@example.com")).rejects.toThrow()
  })
})
