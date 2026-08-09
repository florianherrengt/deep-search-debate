import { defineConfig } from "vitest/config"

export default defineConfig({
  test: {
    include: ["**/*.test.ts"],
    setupFiles: ["./db/testSetup.ts"],
    env: {
      SEARXNG_URL: "http://localhost:8090/",
      BRAVE_SEARCH_API_KEY: "test-key",
      DEEPSEEK_API_KEY: "test-key",
      LLM_PROVIDER: "deepseek",
      LLM_MODEL_NAME: "deepseek-v4-flash",
      SCRAPINGANT_API_KEY: "test-key",
      DATABASE_URL: ":memory:",
      NODE_ENV: "test",
      BETTER_AUTH_URL: "http://localhost:5173",
      BETTER_AUTH_SECRET: "test-secret-that-is-at-least-thirty-two-characters",
      GITHUB_CLIENT_ID: "test-github-client-id",
      GITHUB_CLIENT_SECRET: "test-github-client-secret",
      AUTH_DEBUG_USER_ENABLED: "true",
      AUTH_DEBUG_USER_PASSWORD: "test-debug-password",
    },
  },
})
