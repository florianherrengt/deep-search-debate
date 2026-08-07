import { describe, expect, it, vi } from "vitest"

vi.mock("./searxng.ts", () => ({
  searxng: vi.fn(),
}))
vi.mock("./brave.ts", () => ({
  brave: vi.fn(),
}))
vi.mock("../config.ts", () => ({
  config: { webSearch: { provider: "brave" } },
}))

import { brave } from "./brave.ts"
import { searxng } from "./searxng.ts"
import { webSearch } from "./index.ts"

describe("webSearch", () => {
  it("delegates to the production Brave provider", async () => {
    const mockResults = [
      { title: "A", shortText: "B", link: "https://a.com" },
      { title: "C", shortText: "D", link: "https://c.com" },
    ]
    vi.mocked(brave).mockResolvedValueOnce(mockResults)

    const results = await webSearch({ query: "hello" })

    expect(results).toEqual(mockResults)
    expect(brave).toHaveBeenCalledWith({ query: "hello" })
    expect(searxng).not.toHaveBeenCalled()
  })
})
