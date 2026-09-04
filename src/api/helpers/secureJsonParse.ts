/** Parses JSON while rejecting keys that can mutate object prototypes. */
export function secureJsonParse(text: string): unknown {
  const value: unknown = JSON.parse(text)
  if (!isJsonObject(value)) return value

  const pending: Record<string, unknown>[] = [value]
  while (pending.length > 0) {
    const current = pending.pop()!
    if (Object.hasOwn(current, "__proto__")) {
      throw new SyntaxError("Object contains forbidden prototype property")
    }
    if (Object.hasOwn(current, "constructor")) {
      const constructor = current.constructor
      if (isJsonObject(constructor) && Object.hasOwn(constructor, "prototype")) {
        throw new SyntaxError("Object contains forbidden prototype property")
      }
    }
    for (const child of Object.values(current)) {
      if (isJsonObject(child)) pending.push(child)
    }
  }
  return value
}

function isJsonObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object"
}
