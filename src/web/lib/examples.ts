import z from "zod"

import { getJson } from "./api.ts"

const exampleDebateSchema = z.object({
  debateJobId: z.uuid(),
  prompt: z.string().min(1),
  slug: z.string().min(1),
  title: z.string().min(1),
})

const exampleDebatesResponseSchema = z.object({
  debates: z.array(exampleDebateSchema),
})

export type ExampleDebate = z.output<typeof exampleDebateSchema>

export async function getExampleDebates(
  signal?: AbortSignal,
): Promise<ExampleDebate[]> {
  const response = await getJson(
    "/api/examples",
    exampleDebatesResponseSchema,
    signal,
  )
  return response.debates
}
