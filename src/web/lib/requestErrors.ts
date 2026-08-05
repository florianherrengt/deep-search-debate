import z from "zod"
import { ApiError } from "./api.ts"

export function getRequestErrorMessage(error: unknown): string {
  if (error instanceof ApiError) {
    if (error.status === 403) {
      return "You do not have permission to access this resource."
    }
    if (error.status >= 500) {
      return "The server could not complete the request. Try again."
    }
    return "The request could not be completed. Check the details and try again."
  }

  if (error instanceof z.ZodError || error instanceof SyntaxError) {
    return "The server returned data in an unexpected format. Try again."
  }

  return "Could not connect to the server. Check your connection and try again."
}
