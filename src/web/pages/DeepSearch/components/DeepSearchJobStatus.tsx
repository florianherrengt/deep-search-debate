import { Alert, Typography } from "@mui/material"

type DeepSearchJobStatusProps = {
  jobId: string | null
  error: string | null
}

export function DeepSearchJobStatus({
  jobId,
  error,
}: DeepSearchJobStatusProps) {
  return (
    <>
      {jobId && (
        <Typography variant="caption" color="text.secondary">
          Job: {jobId}
        </Typography>
      )}

      {error && <Alert severity="error">{error}</Alert>}
    </>
  )
}
