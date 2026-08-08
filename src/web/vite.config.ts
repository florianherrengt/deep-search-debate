import { defineConfig, loadEnv } from "vite"
import react from "@vitejs/plugin-react"
import { resolveViteEnvironment } from "./viteEnvironment.ts"

export default defineConfig(({ mode }) => {
  const environment = resolveViteEnvironment(
    { ...loadEnv(mode, process.cwd(), ""), ...process.env },
  )

  return {
    plugins: [react()],
    server: {
      port: environment.port,
      strictPort: true,
      proxy: {
        "/api": environment.apiTarget,
      },
    },
  }
})
