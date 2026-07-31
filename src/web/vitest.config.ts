import { defineConfig } from "vitest/config"
import { fileURLToPath } from "node:url"

const dirname = fileURLToPath(new URL(".", import.meta.url))

export default defineConfig({
  test: {
    globals: true,
    environment: "jsdom",
    setupFiles: [`${dirname}/test-setup.ts`],
    include: ["**/*.test.{ts,tsx}"],
  },
})
