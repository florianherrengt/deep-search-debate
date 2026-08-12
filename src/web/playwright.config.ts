import { defineConfig, devices } from "@playwright/test"
import { fileURLToPath } from "node:url"
import { join } from "node:path"
import { tmpdir } from "node:os"

const API = process.env.PLAYWRIGHT_API_ORIGIN ?? "http://localhost:3100"
const WEB = process.env.PLAYWRIGHT_WEB_ORIGIN ?? "http://localhost:5174"
const e2eDatabase = join(
  tmpdir(),
  `rethinkloop-e2e-${process.pid}.db`,
)
process.env.PLAYWRIGHT_E2E_DATABASE_URL = e2eDatabase
const mockExternalServices = fileURLToPath(
  new URL("../api/e2e/mockExternalServices.mjs", import.meta.url),
)

export default defineConfig({
  testDir: "./e2e",
  fullyParallel: false,
  workers: 1,
  retries: process.env.CI ? 1 : 0,
  reporter: "list",
  globalTeardown: "./e2e/globalTeardown.ts",
  use: {
    baseURL: WEB,
    trace: "on-first-retry",
  },
  // The real API and Vite app run on isolated ports. A Node preload replaces
  // only outbound DeepSeek, SearXNG, and ScrapingAnt responses, keeping routes,
  // SQLite, extraction, NDJSON streams, and the browser UI deterministic.
  webServer: [
    {
      command: "npm run start",
      cwd: "../api",
      url: `${API}/api/ping`,
      reuseExistingServer: false,
      timeout: 30_000,
      env: {
        API_HOST: "127.0.0.1",
        PORT: new URL(API).port,
        DATABASE_URL: e2eDatabase,
        DEEPSEEK_API_KEY: "e2e-deepseek-key",
        LLM_PROVIDER: "deepseek",
        LLM_MODEL_NAME: "deepseek-v4-flash",
        RESEARCH_MAX_ROOT_JOB_CREATIONS_PER_WINDOW: "100",
        DEEP_SEARCH_MAX_ROOT_JOB_CREATIONS_PER_WINDOW: "100",
        IDEA_JOB_MAX_ROOT_JOB_CREATIONS_PER_WINDOW: "100",
        DEBATE_MAX_ROOT_JOB_CREATIONS_PER_WINDOW: "100",
        SEARXNG_URL: "https://e2e-search.test",
        SCRAPINGANT_API_KEY: "e2e-scrapingant-key",
        NODE_ENV: "test",
        BETTER_AUTH_URL: WEB,
        BETTER_AUTH_SECRET:
          "e2e-secret-that-is-at-least-thirty-two-characters",
        GITHUB_CLIENT_ID: "e2e-github-client-id",
        GITHUB_CLIENT_SECRET: "e2e-github-client-secret",
        AUTH_DEBUG_USER_ENABLED: "true",
        AUTH_DEBUG_USER_PASSWORD: "e2e-debug-password",
        NODE_OPTIONS: `--import=${mockExternalServices}`,
      },
    },
    {
      command: "npx vite",
      url: WEB,
      reuseExistingServer: false,
      timeout: 30_000,
      env: { VITE_PORT: new URL(WEB).port, VITE_API_TARGET: API },
    },
  ],
  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] },
    },
  ],
})
