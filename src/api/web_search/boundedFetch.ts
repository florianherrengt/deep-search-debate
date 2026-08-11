async function readBoundedBody(
  response: Response,
  maxBytes: number,
): Promise<Uint8Array> {
  const contentLength = Number(response.headers.get("content-length"))
  if (Number.isFinite(contentLength) && contentLength > maxBytes) {
    await response.body?.cancel().catch(() => undefined)
    throw new Error(`Web search response exceeded ${maxBytes} bytes`)
  }
  if (!response.body) return new Uint8Array()

  const reader = response.body.getReader()
  const chunks: Uint8Array[] = []
  let size = 0
  while (true) {
    const chunk = await reader.read()
    if (chunk.done) break
    size += chunk.value.byteLength
    if (size > maxBytes) {
      await reader.cancel().catch(() => undefined)
      throw new Error(`Web search response exceeded ${maxBytes} bytes`)
    }
    chunks.push(chunk.value)
  }

  const body = new Uint8Array(size)
  let offset = 0
  for (const chunk of chunks) {
    body.set(chunk, offset)
    offset += chunk.byteLength
  }
  return body
}

/** Caps provider response bodies before their JSON parsers allocate them. */
export function createBoundedFetch(
  maxBytes: number,
  fetchImpl: typeof globalThis.fetch = globalThis.fetch,
): typeof globalThis.fetch {
  return async (input, init) => {
    const response = await fetchImpl(input, init)
    // Some focused unit tests use the dependency's minimal response contract.
    // Production fetch always returns Response and therefore always takes the
    // bounded path.
    if (!(response instanceof Response)) return response
    const body = await readBoundedBody(response, maxBytes)
    const copiedBody = new Uint8Array(body.byteLength)
    copiedBody.set(body)
    return new Response(copiedBody.byteLength === 0 ? null : copiedBody.buffer, {
      status: response.status,
      statusText: response.statusText,
      headers: response.headers,
    })
  }
}
