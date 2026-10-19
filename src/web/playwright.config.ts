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
  // only outbound Pi LLM, SearXNG, and page retrieval, keeping routes,
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
        SEARXNG_URL: "https://e2e-search.test",
        BROWSERLESS_URL: "http://e2e-browserless.test",
        BROWSERLESS_TOKEN: "e2e-browserless-token",
        PAGE_FETCH_QUEUE_WAIT_TIMEOUT_MS: "120000",
        PAGE_FETCH_REQUEST_TIMEOUT_MS: "35000",
        PAGE_FETCH_MAX_RESPONSE_BYTES: "2000000",
        NODE_ENV: "test",
        BETTER_AUTH_URL: WEB,
        BETTER_AUTH_SECRET:
          "e2e-secret-that-is-at-least-thirty-two-characters",
        GITHUB_CLIENT_ID: "e2e-github-client-id",
        GITHUB_CLIENT_SECRET: "e2e-github-client-secret",
        OPENAI_CODEX_CREDENTIAL_KEY:
          "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=",
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
