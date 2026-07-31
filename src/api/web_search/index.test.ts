import { describe, expect, it, vi } from "vitest";

vi.mock("./searxng.ts", () => ({
  searxng: vi.fn(),
}));

import { searxng } from "./searxng.ts";
import { webSearch } from "./index.ts";

describe("webSearch", () => {
  it("delegates to searxng and returns results", async () => {
    const mockResults = [
      { title: "A", shortText: "B", link: "https://a.com" },
      { title: "C", shortText: "D", link: "https://c.com" },
    ];
    vi.mocked(searxng).mockResolvedValueOnce(mockResults);

    const results = await webSearch({ query: "hello" });

    expect(results).toEqual(mockResults);
    expect(searxng).toHaveBeenCalledWith({ query: "hello" });
  });
});
