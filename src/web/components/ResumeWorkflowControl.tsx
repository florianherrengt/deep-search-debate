import Button from "@mui/material/Button"

type ResumeWorkflowControlProps = {
  canResume: boolean
  pending: boolean
  onResume: () => void
}

export function ResumeWorkflowControl({
  canResume,
  pending,
  onResume,
}: ResumeWorkflowControlProps) {
  if (!canResume) return null

  return (
    <Button
      size="small"
      sx={{ height: 30, minHeight: 0, py: 0 }}
      variant="contained"
      disabled={pending}
      onClick={onResume}
    >
      {pending ? "Resuming…" : "Resume workflow"}
    </Button>
  )
}
