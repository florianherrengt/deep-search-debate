import { beforeEach, describe, expect, it, vi } from "vitest"

const mockFetch = vi.fn()
globalThis.fetch = mockFetch

import { brave } from "./brave.ts"

describe("brave", () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it("searches Brave and maps validated results", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      status: 200,
      text: () =>
        Promise.resolve(
          JSON.stringify({
            web: {
              results: [
                {
                  title: "Test title",
                  description: "Test snippet",
                  url: "https://example.com",
                },
              ],
            },
          }),
        ),
    })

    await expect(brave({ query: "test" })).resolves.toEqual([
      {
        title: "Test title",
        shortText: "Test snippet",
        link: "https://example.com",
      },
    ])

    const [url, init] = mockFetch.mock.calls[0] as [string, RequestInit]
    expect(new URL(url).hostname).toBe("api.search.brave.com")
    expect(new URL(url).searchParams.get("q")).toBe("test")
    expect(init.headers).toMatchObject({ "x-subscription-token": "test-key" })
  })

  it("throws when Brave returns an error", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: false,
      status: 429,
      statusText: "Too Many Requests",
      text: () => Promise.resolve("rate limited"),
    })

    await expect(brave({ query: "test" })).rejects.toThrow(/Brave/)
  })
})
