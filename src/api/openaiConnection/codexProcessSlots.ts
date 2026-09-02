type Release = () => void

const userTails = new Map<string, Promise<void>>()
let loginActive = false

function abortReason(signal: AbortSignal): unknown {
  return signal.reason ?? new DOMException("The operation was aborted", "AbortError")
}

async function waitForPrevious(
  previous: Promise<void>,
  signal?: AbortSignal,
): Promise<void> {
  if (!signal) return previous
  if (signal.aborted) throw abortReason(signal)

  let rejectOnAbort: ((reason: unknown) => void) | undefined
  const aborted = new Promise<never>((_resolve, reject) => {
    rejectOnAbort = reject
  })
  const onAbort = () => rejectOnAbort?.(abortReason(signal))
  signal.addEventListener("abort", onAbort, { once: true })
  try {
    await Promise.race([previous, aborted])
  } finally {
    signal.removeEventListener("abort", onAbort)
  }
}

/** Serializes credential-bearing Codex generation processes for one user. */
export async function acquireCodexProcess(
  userId: string,
  options: { signal?: AbortSignal } = {},
): Promise<Release> {
  if (options.signal?.aborted) throw abortReason(options.signal)
  const previous = userTails.get(userId) ?? Promise.resolve()

  const held = Promise.withResolvers<void>()
  const tail = previous.then(() => held.promise)
  userTails.set(userId, tail)
  try {
    await waitForPrevious(previous, options.signal)
  } catch (error) {
    held.resolve()
    void tail.then(() => {
      if (userTails.get(userId) === tail) userTails.delete(userId)
    })
    throw error
  }

  let released = false
  return () => {
    if (released) return
    released = true
    held.resolve()
    if (userTails.get(userId) === tail) userTails.delete(userId)
  }
}

/** Keeps long-lived device login processes outside generation capacity. */
export function acquireCodexLoginProcess(): Release | undefined {
  if (loginActive) return

  loginActive = true
  let released = false
  return () => {
    if (released) return
    released = true
    loginActive = false
  }
}
