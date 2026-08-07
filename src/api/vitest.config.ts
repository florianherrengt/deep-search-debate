import { defineConfig } from "vitest/config"

export default defineConfig({
  test: {
    include: ["**/*.test.ts"],
    globalSetup: ["./testGlobalSetup.ts"],
    setupFiles: ["./db/testSetup.ts"],
    env: {
      KDBX_PASSWORD: "test-keepass-master-password",
      SEARXNG_URL: "http://localhost:8090/",
      BRAVE_SEARCH_API_KEY: "test-key",
      DEEPSEEK_API_KEY: "test-key",
      SCRAPINGANT_API_KEY: "test-key",
      SCRAPINGANT_RETRY_DELAY_MS: "0",
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
