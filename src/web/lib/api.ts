import z from "zod"
import { readNdjson } from "./ndjson.ts"

const openAiCodexErrorCodeSchema = z.enum([
  "authentication-required",
  "rate-limited",
  "workspace-disabled",
  "protocol-incompatible",
  "temporarily-unavailable",
  "timeout",
  "tool-blocked",
])

export type OpenAiCodexErrorCode = z.infer<
  typeof openAiCodexErrorCodeSchema
>

const failedResponseSchema = z.object({ code: openAiCodexErrorCodeSchema })
const maxFailedResponseBytes = 4_096

export class ApiError extends Error {
  override readonly name = "ApiError"
  readonly code?: OpenAiCodexErrorCode

  constructor(
    readonly method: string,
    readonly url: string,
    readonly status: number,
    code?: OpenAiCodexErrorCode,
  ) {
    super(`${method} ${url} failed: ${status}`)
    if (code !== undefined) this.code = code
  }
}

async function readFailedResponseCode(
  response: Response,
): Promise<OpenAiCodexErrorCode | undefined> {
  const reader = response.body?.getReader()
  if (!reader) return undefined

  const chunks: Uint8Array[] = []
  let byteLength = 0

  try {
    while (true) {
      const result = await reader.read()
      if (result.done) break

      byteLength += result.value.byteLength
      if (byteLength > maxFailedResponseBytes) {
        await reader.cancel()
        return undefined
      }
      chunks.push(result.value)
    }

    const bytes = new Uint8Array(byteLength)
    let offset = 0
    for (const chunk of chunks) {
      bytes.set(chunk, offset)
      offset += chunk.byteLength
    }

    const payload: unknown = JSON.parse(new TextDecoder().decode(bytes))
    const result = failedResponseSchema.safeParse(payload)
    return result.success ? result.data.code : undefined
  } catch {
    return undefined
  } finally {
    reader.releaseLock()
  }
}

async function createApiError(
  method: string,
  url: string,
  response: Response,
): Promise<ApiError> {
  return new ApiError(
    method,
    url,
    response.status,
    await readFailedResponseCode(response),
  )
}

/** Fetches JSON and validates the response at the network boundary. */
export async function getJson<Schema extends z.ZodType>(
  url: string,
  schema: Schema,
  signal?: AbortSignal,
): Promise<z.output<Schema>> {
  const response = await fetch(url, { signal })

  if (!response.ok) {
    throw await createApiError("GET", url, response)
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
    throw await createApiError("POST", url, response)
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
    throw await createApiError("PATCH", url, response)
  }

  return schema.parse(await response.json())
}

/** Deletes a resource and validates the JSON response at the network boundary. */
export async function deleteJson<Schema extends z.ZodType>(
  url: string,
  schema: Schema,
  signal?: AbortSignal,
): Promise<z.output<Schema>> {
  const response = await fetch(url, { method: "DELETE", signal })

  if (!response.ok) {
    throw await createApiError("DELETE", url, response)
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
    throw await createApiError("GET", url, response)
  }
  if (!response.body) {
    throw new Error(`GET ${url} response has no body`)
  }

  onOpen?.()
  yield* readNdjson(response.body, schema)
}
