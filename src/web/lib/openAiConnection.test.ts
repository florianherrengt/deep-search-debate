import { afterEach, describe, expect, it, vi } from "vitest"

import {
  deleteOpenAiConnection,
  getOpenAiConnection,
  openAiConnectionSnapshotSchema,
  startOpenAiConnection,
} from "./openAiConnection.ts"

describe("OpenAI connection API", () => {
  afterEach(() => vi.unstubAllGlobals())

  it("accepts each connection state and rejects malformed pending data", () => {
    expect(
      openAiConnectionSnapshotSchema.safeParse({ status: "connected" })
        .success,
    ).toBe(true)
    expect(
      openAiConnectionSnapshotSchema.safeParse({ status: "disconnected" })
        .success,
    ).toBe(true)
    expect(
      openAiConnectionSnapshotSchema.safeParse({
        status: "failed",
        message: "Your connection expired.",
      }).success,
    ).toBe(true)
    for (const verificationUrl of ["not a URL", "http://openai.test/device"]) {
      expect(
        openAiConnectionSnapshotSchema.safeParse({
          status: "pending",
          verificationUrl,
          userCode: "ABCD-EFGH",
          expiresAt: "2026-08-25T12:00:00.000Z",
        }).success,
      ).toBe(false)
    }
  })

  it("uses the authenticated connection endpoints", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(Response.json({ status: "disconnected" }))
      .mockResolvedValueOnce(
        Response.json({
          status: "pending",
          verificationUrl: "https://auth.openai.com/device",
          userCode: "ABCD-EFGH",
          expiresAt: "2026-08-25T12:00:00.000Z",
        }),
      )
      .mockResolvedValueOnce(Response.json({ status: "disconnected" }))
    vi.stubGlobal("fetch", fetchMock)

    await getOpenAiConnection()
    await startOpenAiConnection()
    await deleteOpenAiConnection()

    expect(fetchMock).toHaveBeenNthCalledWith(1, "/api/openai-connection", {
      signal: undefined,
    })
    expect(fetchMock).toHaveBeenNthCalledWith(
      2,
      "/api/openai-connection/start",
      {
        body: "{}",
        headers: { "Content-Type": "application/json" },
        method: "POST",
        signal: undefined,
      },
    )
    expect(fetchMock).toHaveBeenNthCalledWith(3, "/api/openai-connection", {
      method: "DELETE",
      signal: undefined,
    })
  })
})
