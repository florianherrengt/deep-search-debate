import z from "zod"

const viteEnvironmentSchema = z.object({
  VITE_PORT: z.coerce.number().int().min(1).max(65_535).default(5173),
  VITE_API_TARGET: z.url().default("http://localhost:3000"),
})

export function resolveViteEnvironment(
  rawEnvironment: Record<string, string | undefined>,
) {
  const environment = viteEnvironmentSchema.parse(rawEnvironment)

  return {
    port: environment.VITE_PORT,
    apiTarget: environment.VITE_API_TARGET,
  }
}
