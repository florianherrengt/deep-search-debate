import { afterEach, describe, expect, it, vi } from "vitest"
import z from "zod"
import {
  deleteJson,
  getJson,
  patchJson,
  postJson,
  putJson,
  subscribeToNdjson,
} from "./api.ts"

describe("API client", () => {
  afterEach(() => vi.unstubAllGlobals())

  it("retains structured response details for failed requests", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(new Response(null, { status: 404 })),
    )

    await expect(getJson("/api/missing", z.object({}))).rejects.toMatchObject({
      method: "GET",
      status: 404,
      url: "/api/missing",
    })
  })

  it.each([
    ["GET JSON", () => getJson("/api/test", z.object({}))],
    ["POST JSON", () => postJson("/api/test", {}, z.object({}))],
    ["PUT JSON", () => putJson("/api/test", {}, z.object({}))],
    ["PATCH JSON", () => patchJson("/api/test", {}, z.object({}))],
    ["DELETE JSON", () => deleteJson("/api/test", z.object({}))],
    [
      "NDJSON initial response",
      () => subscribeToNdjson("/api/test", z.object({})).next(),
    ],
  ])(
    "retains only an allowlisted error code for a failed %s request",
    async (_name, request) => {
      const secret = "SECRET_SENTINEL_FROM_SERVER"
      vi.stubGlobal(
        "fetch",
        vi.fn().mockResolvedValue(
          Response.json(
            {
              code: "rate-limited",
              error: `Upstream response included ${secret}`,
              metadata: { secret },
            },
            { status: 429 },
          ),
        ),
      )

      const error = await request().catch((caught: unknown) => caught)

      expect(error).toMatchObject({
        code: "rate-limited",
        status: 429,
      })
      expect(String(error)).not.toContain(secret)
      expect(JSON.stringify(error)).not.toContain(secret)
    },
  )

  it.each(["not-a-stable-code", "x".repeat(5_000)])(
    "discards an unrecognized or oversized error code: %s",
    async (code) => {
      vi.stubGlobal(
        "fetch",
        vi.fn().mockResolvedValue(
          Response.json({ code, error: "unsafe server detail" }, { status: 503 }),
        ),
      )

      const error = await getJson("/api/test", z.object({})).catch(
        (caught: unknown) => caught,
      )

      expect(error).toMatchObject({ status: 503 })
      expect(error).not.toHaveProperty("code")
      expect(JSON.stringify(error)).not.toContain("unsafe server detail")
    },
  )

  it("deletes a resource and validates its response", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(
        Response.json({ status: "disconnected" }, { status: 200 }),
      )
    vi.stubGlobal("fetch", fetchMock)

    await expect(
      deleteJson(
        "/api/openai-connection",
        z.object({ status: z.literal("disconnected") }),
      ),
    ).resolves.toEqual({ status: "disconnected" })
    expect(fetchMock).toHaveBeenCalledWith("/api/openai-connection", {
      method: "DELETE",
      signal: undefined,
    })
  })
})
