import type z from "zod"
import { readNdjson } from "./ndjson.ts"

/** Fetches JSON and validates the response at the network boundary. */
export async function getJson<Schema extends z.ZodType>(
  url: string,
  schema: Schema,
  signal?: AbortSignal,
): Promise<z.output<Schema>> {
  const response = await fetch(url, { signal })

  if (!response.ok) {
    throw new Error(`GET ${url} failed: ${response.status}`)
  }

  return schema.parse(await response.json())
}

/** Posts JSON and validates the response at the network boundary. */
export async function postJson<Schema extends z.ZodType>(
  url: string,
  body: unknown,
  schema: Schema,
  signal?: AbortSignal,
): Promise<z.output<Schema>> {
  const response = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
    signal,
  })

  if (!response.ok) {
    throw new Error(`POST ${url} failed: ${response.status}`)
  }

  return schema.parse(await response.json())
}

/** Replays and follows an NDJSON endpoint with every event validated. */
export async function* subscribeToNdjson<Schema extends z.ZodType>(
  url: string,
  schema: Schema,
  signal?: AbortSignal,
  onOpen?: () => void,
): AsyncGenerator<z.output<Schema>> {
  const response = await fetch(url, { signal })

  if (!response.ok) {
    throw new Error(`GET ${url} failed: ${response.status}`)
  }
  if (!response.body) {
    throw new Error(`GET ${url} response has no body`)
  }

  onOpen?.()
  yield* readNdjson(response.body, schema)
}
