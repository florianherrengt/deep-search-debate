import type z from "zod"

export class MalformedNdjsonError extends Error {
  override readonly name = "MalformedNdjsonError"

  constructor() {
    super("NDJSON response contains malformed JSON")
  }
}

class TruncatedNdjsonError extends Error {
  override readonly name = "TruncatedNdjsonError"

  constructor() {
    super("NDJSON response ended with a truncated record")
  }
}

function parseRecord(value: string, trailing: boolean): unknown {
  try {
    return JSON.parse(value) as unknown
  } catch {
    if (trailing) throw new TruncatedNdjsonError()
    throw new MalformedNdjsonError()
  }
}

export async function* readNdjson<Schema extends z.ZodType>(
  body: ReadableStream<Uint8Array>,
  schema: Schema,
): AsyncGenerator<z.output<Schema>> {
  const reader = body.getReader()
  const decoder = new TextDecoder()
  let buffer = ""

  try {
    while (true) {
      const { done, value } = await reader.read()
      if (done) break

      buffer += decoder.decode(value, { stream: true })
      const lines = buffer.split("\n")
      buffer = lines.pop() ?? ""

      for (const line of lines) {
        const value = line.trim()
        if (value) yield schema.parse(parseRecord(value, false))
      }
    }

    buffer += decoder.decode()
    const value = buffer.trim()
    if (value) yield schema.parse(parseRecord(value, true))
  } finally {
    reader.releaseLock()
  }
}
