import { defineConfig, devices } from "@playwright/test"

const API = "http://localhost:3100"
const WEB = "http://localhost:5174"

export default defineConfig({
  testDir: "./e2e",
  fullyParallel: false,
  workers: 1,
  retries: process.env.CI ? 1 : 0,
  reporter: "list",
  use: {
    baseURL: WEB,
    trace: "on-first-retry",
  },
  // Real stack, no mocking: the actual API (makes a real DeepSeek LLM call)
  // on a dedicated port, and a dedicated Vite dev server proxied to it. Both
  // use isolated ports so the e2e never collides with a manually-run
  // `npm run dev` (:3000) / `npm run dev:web` (:5173).
  webServer: [
    {
      command: "npm run start",
      cwd: "../api",
      url: `${API}/api/ping`,
      reuseExistingServer: !process.env.CI,
      timeout: 30_000,
      env: { PORT: "3100" },
    },
    {
      command: "npx vite --port 5174 --strictPort",
      url: WEB,
      reuseExistingServer: !process.env.CI,
      timeout: 30_000,
      env: { VITE_API_TARGET: API },
    },
  ],
  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] },
    },
  ],
})
