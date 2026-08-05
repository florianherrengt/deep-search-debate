import z from "zod"
import { subscribeToNdjson } from "./api.ts"

const textStreamEventSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("reasoning"), text: z.string() }),
  z.object({ type: z.literal("text"), text: z.string() }),
  z.object({ type: z.literal("error"), message: z.string() }),
  z.object({ type: z.literal("done") }),
])

export type TextStreamEvent = z.infer<typeof textStreamEventSchema>

export async function* subscribeToTextStream(
  id: string,
  signal?: AbortSignal,
  onOpen?: () => void,
): AsyncGenerator<TextStreamEvent> {
  yield* subscribeToNdjson(
    `/api/streams/${encodeURIComponent(id)}`,
    textStreamEventSchema,
    signal,
    onOpen,
  )
}
