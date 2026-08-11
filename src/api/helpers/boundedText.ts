const omissionMarker = "[... omitted ...]"

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
