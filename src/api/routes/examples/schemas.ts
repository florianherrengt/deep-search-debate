import z from "zod"

const exampleDebateSchema = z.object({
  debateJobId: z.uuid(),
  prompt: z.string().min(1),
  slug: z.string().min(1),
  title: z.string().min(1),
})

export const exampleDebatesResponseSchema = z.object({
  debates: z.array(exampleDebateSchema),
})
