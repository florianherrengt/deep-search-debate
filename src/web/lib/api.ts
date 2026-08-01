import { readNdjson } from "./ndjson.ts"

/** Posts JSON and returns the ID from the response body. */
export async function postForId(
  url: string,
  body: unknown,
  signal?: AbortSignal,
): Promise<string> {
  const response = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
    signal,
  })

  if (!response.ok) {
    throw new Error(`POST ${url} failed: ${response.status}`)
  }

  const result = (await response.json()) as unknown
  if (
    !result ||
    typeof result !== "object" ||
    !("id" in result) ||
    typeof result.id !== "string"
  ) {
    throw new Error(`POST ${url} response has no ID`)
  }

  return result.id
}

/** Replays and follows an NDJSON endpoint as parsed events. */
export async function* subscribeToNdjson<T>(
  url: string,
  signal?: AbortSignal,
): AsyncGenerator<T> {
  const response = await fetch(url, { signal })

  if (!response.ok) {
    throw new Error(`GET ${url} failed: ${response.status}`)
  }
  if (!response.body) {
    throw new Error(`GET ${url} response has no body`)
  }

  yield* readNdjson<T>(response.body)
}
