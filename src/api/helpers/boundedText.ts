const omissionMarker = "[... omitted ...]"

/** Keeps verbatim, query-relevant source windows in document order. */
export function selectRelevantPassages(text: string, query: string, maxChars: number): string {
  if (maxChars <= 0) return ""
  if (text.length <= maxChars) return text
  const terms = new Set(query.toLocaleLowerCase().match(/[\p{L}\p{N}]{3,}/gu) ?? [])
  for (const word of ["the", "and", "for", "with", "that", "this", "from", "what", "which", "have", "are", "can", "should", "research", "find", "best"]) terms.delete(word)
  const windows: Array<{ start: number; end: number; matches: Set<string> }> = []
  const windowChars = Math.max(1, Math.min(2_000, maxChars))
  for (let start = 0; start < text.length;) {
    let end = Math.min(text.length, start + windowChars)
    if (end < text.length) {
      const boundary = Math.max(text.lastIndexOf("\n", end), text.lastIndexOf(" ", end))
      if (boundary > start + windowChars / 2) end = boundary
    }
    const words = new Set(text.slice(start, end).toLocaleLowerCase().match(/[\p{L}\p{N}]{3,}/gu) ?? [])
    windows.push({ start, end, matches: new Set([...terms].filter((term) => words.has(term))) })
    start = end
  }
  const frequency = new Map([...terms].map((term) => [term, windows.filter((window) => window.matches.has(term)).length]))
  const ranked = windows.map((window, index) => ({
    ...window, index,
    score: [...window.matches].reduce((total, term) => total + 1 / (frequency.get(term) ?? 1), 0),
  })).toSorted((a, b) => b.score - a.score || a.index - b.index)
  if (ranked[0]?.score === 0) return truncateMiddle(text, maxChars)
  const selected: typeof ranked = []
  let remaining = maxChars
  const separator = `\n${omissionMarker}\n`
  for (const window of ranked) {
    const cost = window.end - window.start + (selected.length ? separator.length : 0)
    if (cost <= remaining) {
      selected.push(window)
      remaining -= cost
    }
  }
  if (selected.length === 0) return truncateMiddle(text, maxChars)
  return selected.toSorted((a, b) => a.index - b.index)
    .map(({ start, end }) => text.slice(start, end)).join(separator)
}

export function truncateMiddle(value: string, maxChars: number): string {
  if (value.length <= maxChars) return value
  if (maxChars <= omissionMarker.length) return value.slice(0, maxChars)

  const retainedChars = maxChars - omissionMarker.length
  const headChars = Math.ceil(retainedChars / 2)
  const tailChars = retainedChars - headChars
  return [
    value.slice(0, headChars),
    omissionMarker,
    tailChars === 0 ? "" : value.slice(-tailChars),
  ].join("")
}

export function allocateFairly(
  desiredChars: readonly number[],
  maxChars: number,
): number[] {
  if (desiredChars.reduce((total, chars) => total + chars, 0) <= maxChars) {
    return [...desiredChars]
  }

  const allocations = desiredChars.map(() => 0)
  let remainingChars = maxChars
  let pending = desiredChars.map((_, index) => index)
  while (pending.length > 0) {
    const equalShare = Math.floor(remainingChars / pending.length)
    const satisfied = pending.filter(
      (index) => desiredChars[index] <= equalShare,
    )
    if (satisfied.length === 0) {
      const extraChars = remainingChars % pending.length
      pending.forEach((index, position) => {
        allocations[index] = equalShare + (position < extraChars ? 1 : 0)
      })
      break
    }

    const satisfiedSet = new Set(satisfied)
    for (const index of satisfied) {
      allocations[index] = desiredChars[index]
      remainingChars -= desiredChars[index]
    }
    pending = pending.filter((index) => !satisfiedSet.has(index))
  }
  return allocations
}

export function formatBoundedTextEntries(
  entries: readonly {
    opening: string
    text: string
    closing: string
  }[],
  maxChars: number,
): string {
  if (entries.length === 0) return ""
  const separator = "\n\n"
  const fixedChars =
    entries.reduce(
      (total, entry) => total + entry.opening.length + entry.closing.length,
      0,
    ) + separator.length * (entries.length - 1)
  if (fixedChars > maxChars) {
    throw new Error("Text context budget is too small for every entry")
  }
  const allocations = allocateFairly(
    entries.map(({ text }) => text.length),
    maxChars - fixedChars,
  )
  return entries
    .map(
      (entry, index) =>
        entry.opening +
        truncateMiddle(entry.text, allocations[index]) +
        entry.closing,
    )
    .join(separator)
}
