import { searxng, type WebSearchResults } from "./searxng.ts";
import z from "zod";

const WebSearchResult = z.object({
  title: z.string(),
  shortText: z.string(),
  link: z.string(),
});

export type { WebSearchResults };

export const webSearch = z
  .function()
  .input(z.tuple([z.object({ query: z.string() })]))
  .output(z.array(WebSearchResult))
  .implementAsync(async (params) => {
    return searxng(params);
  });
