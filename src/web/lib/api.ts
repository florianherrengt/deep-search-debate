import type z from "zod"
import { readNdjson } from "./ndjson.ts"

export class ApiError extends Error {
  override readonly name = "ApiError"

  constructor(
    readonly method: string,
    readonly url: string,
    readonly status: number,
  ) {
    super(`${method} ${url} failed: ${status}`)
  }
}

/** Fetches JSON and validates the response at the network boundary. */
export async function getJson<Schema extends z.ZodType>(
  url: string,
  schema: Schema,
  signal?: AbortSignal,
): Promise<z.output<Schema>> {
  const response = await fetch(url, { signal })

  if (!response.ok) {
    throw new ApiError("GET", url, response.status)
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
    throw new ApiError("POST", url, response.status)
  }

  return schema.parse(await response.json())
}

/** Patches JSON and validates the response at the network boundary. */
export async function patchJson<Schema extends z.ZodType>(
  url: string,
  body: unknown,
  schema: Schema,
  signal?: AbortSignal,
): Promise<z.output<Schema>> {
  const response = await fetch(url, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
    signal,
  })

  if (!response.ok) {
    throw new ApiError("PATCH", url, response.status)
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
    throw new ApiError("GET", url, response.status)
  }
  if (!response.body) {
    throw new Error(`GET ${url} response has no body`)
  }

  onOpen?.()
  yield* readNdjson(response.body, schema)
}
