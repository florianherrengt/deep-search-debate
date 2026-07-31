const searxngUrl = process.env.SEARXNG_URL;
if (!searxngUrl) throw new Error("SEARXNG_URL is not configured");

const deepseekApiKey = process.env.DEEPSEEK_API_KEY;
if (!deepseekApiKey) throw new Error("DEEPSEEK_API_KEY is not configured");

const databaseUrl = process.env.DATABASE_URL ?? "data.db";

export const config = {
  db: { url: databaseUrl },
  webSearch: {
    searxng: { url: searxngUrl },
  },
  llm: {
    deepseek: {
      apiKey: deepseekApiKey,
      model: "deepseek-v4-flash",
    },
  },
};
