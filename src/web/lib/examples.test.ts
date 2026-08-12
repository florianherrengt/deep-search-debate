import { afterEach, describe, expect, it, vi } from "vitest"

import { getExampleDebates } from "./examples.ts"

describe("examples client", () => {
  afterEach(() => vi.unstubAllGlobals())

  it("loads and validates the curated debate list", async () => {
    const debates = [
      {
        debateJobId: "11111111-1111-4111-8111-111111111111",
        prompt: "Should cities replace parking with housing?",
        slug: "parking-or-housing",
        title: "Parking or housing",
      },
    ]
    const fetchMock = vi.fn().mockResolvedValue(Response.json({ debates }))
    vi.stubGlobal("fetch", fetchMock)

    await expect(getExampleDebates()).resolves.toEqual(debates)
    expect(fetchMock).toHaveBeenCalledWith("/api/examples", {
      signal: undefined,
    })
  })

  it("rejects malformed examples at the network boundary", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        Response.json({
          debates: [{ debateJobId: "not-a-uuid", title: "Incomplete" }],
        }),
      ),
    )

    await expect(getExampleDebates()).rejects.toThrow()
  })
})
