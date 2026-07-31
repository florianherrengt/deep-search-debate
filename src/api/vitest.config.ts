import { defineConfig } from "vitest/config"

export default defineConfig({
  test: {
    include: ["**/*.test.ts"],
    env: {
      SEARXNG_URL: "http://localhost:8090/",
      DEEPSEEK_API_KEY: "test-key",
      DATABASE_URL: ":memory:",
    },
  },
})
