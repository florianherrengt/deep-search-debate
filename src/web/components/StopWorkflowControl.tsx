import { useState } from "react"
import Button from "@mui/material/Button"
import Dialog from "@mui/material/Dialog"
import DialogActions from "@mui/material/DialogActions"
import DialogContent from "@mui/material/DialogContent"
import DialogContentText from "@mui/material/DialogContentText"
import DialogTitle from "@mui/material/DialogTitle"

type StopWorkflowControlProps = {
  canStop: boolean
  pending: boolean
  stopping?: boolean
  onConfirm: () => void
}

/** Shared confirmation UI; workflow pages opt in during their vertical rollout. */
export function StopWorkflowControl({
  canStop,
  pending,
  stopping = false,
  onConfirm,
}: StopWorkflowControlProps) {
  const [open, setOpen] = useState(false)
  const busy = pending || stopping

  if (!canStop && !stopping) return null

  return (
    <>
      <Button
        color="error"
        size="small"
        sx={{ height: 30, minHeight: 0, py: 0 }}
        variant="outlined"
        disabled={busy}
        onClick={() => setOpen(true)}
      >
        {busy ? "Stopping…" : "Stop workflow"}
      </Button>
      <Dialog
        open={open && !stopping}
        onClose={busy ? undefined : () => setOpen(false)}
        aria-labelledby="stop-workflow-dialog-title"
        aria-describedby="stop-workflow-dialog-description"
      >
        <DialogTitle id="stop-workflow-dialog-title">
          Stop this workflow?
        </DialogTitle>
        <DialogContent sx={{ display: "grid", gap: 1 }}>
          <DialogContentText id="stop-workflow-dialog-description">
            Stopping ends the current run. Completed work is kept, and you can
            resume it later.
          </DialogContentText>
          <DialogContentText>
            Completed usage remains charged; stopped in-progress attempts do
            not debit RethinkLoop credits.
          </DialogContentText>
        </DialogContent>
        <DialogActions>
          <Button disabled={busy} onClick={() => setOpen(false)}>
            Keep running
          </Button>
          <Button
            color="error"
            variant="contained"
            disabled={busy}
            onClick={() => {
              setOpen(false)
              onConfirm()
            }}
          >
            {busy ? "Stopping…" : "Stop workflow"}
          </Button>
        </DialogActions>
      </Dialog>
    </>
  )
}
