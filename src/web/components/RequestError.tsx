import { Alert, Button } from "@mui/material"
import { ApiError } from "../lib/api.ts"
import { getRequestErrorMessage } from "../lib/requestErrors.ts"
import { NotFound } from "./NotFound.tsx"

type RequestErrorProps = {
  error: unknown
  notFoundTitle?: string
  notFoundMessage?: string
  onRetry?: () => void
}

export function RequestError({
  error,
  notFoundTitle,
  notFoundMessage,
  onRetry,
}: RequestErrorProps) {
  if (error instanceof ApiError && error.status === 404 && notFoundTitle) {
    return <NotFound message={notFoundMessage} title={notFoundTitle} />
  }

  return (
    <Alert
      action={
        onRetry ? (
          <Button color="inherit" onClick={onRetry} size="small">
            Try again
          </Button>
        ) : undefined
      }
      severity="error"
    >
      {getRequestErrorMessage(error)}
    </Alert>
  )
}
