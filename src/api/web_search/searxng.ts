import { config } from "../config.ts";
import z from "zod";

const searxngRawResultSchema = z.object({
  title: z.string(),
  content: z.string(),
  url: z.string(),
});

const searxngJsonSchema = z.object({
  query: z.string(),
  results: z.array(searxngRawResultSchema),
});

const webSearchResultSchema = z.object({
  title: z.string(),
  shortText: z.string(),
  link: z.string(),
});

export const searxng = z
  .function()
  .input(z.tuple([z.object({ query: z.string() })]))
  .output(z.array(webSearchResultSchema))
  .implementAsync(async (params) => {
    const baseUrl = config.webSearch.searxng.url;
    const url = new URL(
      "/search",
      baseUrl.startsWith("http") ? baseUrl : `http://${baseUrl}`,
    );
    url.searchParams.set("q", params.query);
    url.searchParams.set("format", "json");
    const res = await fetch(url.toString());
    if (!res.ok) throw new Error(`SearXNG search failed: ${res.status}`);
    const data = searxngJsonSchema.parse(await res.json());
    return data.results.map((r) => ({
      title: r.title,
      shortText: r.content,
      link: r.url,
    }));
  });
