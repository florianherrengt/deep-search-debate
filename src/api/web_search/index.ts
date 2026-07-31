import { searxng } from "./searxng.ts";
import z from "zod";

const webSearchResultSchema = z.object({
  title: z.string(),
  shortText: z.string(),
  link: z.string(),
});

export const webSearch = z
  .function()
  .input(z.tuple([z.object({ query: z.string() })]))
  .output(z.array(webSearchResultSchema))
  .implementAsync(async (params) => {
    return searxng(params);
  });
