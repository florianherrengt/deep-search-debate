import { defineConfig } from "vitest/config"

export default defineConfig({
  test: {
    include: ["**/*.test.ts"],
    setupFiles: ["./db/testSetup.ts"],
    env: {
      SEARXNG_URL: "http://localhost:8090/",
      DEEPSEEK_API_KEY: "test-key",
      SCRAPINGANT_API_KEY: "test-key",
      SCRAPINGANT_RETRY_DELAY_MS: "0",
      DATABASE_URL: ":memory:",
    },
  },
})
