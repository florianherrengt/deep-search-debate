import { describe, expect, it, vi } from "vitest";

vi.mock("../web_search/index.ts", () => ({
  webSearch: vi.fn(),
}));

import { webSearch } from "../web_search/index.ts";
import { app } from "../index.ts";

describe("GET /api/debug/search", () => {
  it("returns search results", async () => {
    const mockResults = [
      { title: "Result 1", shortText: "Snippet 1", link: "https://one.com" },
      { title: "Result 2", shortText: "Snippet 2", link: "https://two.com" },
    ];
    vi.mocked(webSearch).mockResolvedValueOnce(mockResults);

    const res = await app.request("/api/debug/search?query=hello");
    expect(res.status).toBe(200);

    const body = await res.json();
    expect(body).toEqual({ results: mockResults });
    expect(webSearch).toHaveBeenCalledWith({ query: "hello" });
  });

  it("returns 500 when webSearch fails", async () => {
    vi.mocked(webSearch).mockRejectedValueOnce(new Error("search failed"));

    const res = await app.request("/api/debug/search?query=fail");
    expect(res.status).toBe(500);
  });
});
