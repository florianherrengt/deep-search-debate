/** Converts an unknown caught value into a displayable message. */
export function getErrorMessage(error: unknown): string {
  if (error instanceof Error) return error.message
  return String(error)
}
