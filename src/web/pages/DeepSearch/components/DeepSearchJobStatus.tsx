import { Alert } from "@mui/material"

type DeepSearchJobStatusProps = {
  error: string | null
}

export function DeepSearchJobStatus({ error }: DeepSearchJobStatusProps) {
  if (!error) return null
  return <Alert severity="error">{error}</Alert>
}
