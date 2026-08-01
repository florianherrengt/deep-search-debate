import type z from "zod"

export async function* readNdjson<Schema extends z.ZodType>(
  body: ReadableStream<Uint8Array>,
  schema: Schema,
): AsyncGenerator<z.output<Schema>> {
  const reader = body.getReader()
  const decoder = new TextDecoder()
  let buffer = ""

  while (true) {
    const { done, value } = await reader.read()
    if (done) break

    buffer += decoder.decode(value, { stream: true })
    const lines = buffer.split("\n")
    buffer = lines.pop() ?? ""

    for (const line of lines) {
      const value = line.trim()
      if (value) yield schema.parse(JSON.parse(value))
    }
  }

  buffer += decoder.decode()
  const value = buffer.trim()
  if (value) yield schema.parse(JSON.parse(value))
}
