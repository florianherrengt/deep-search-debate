import ContentCopyRounded from "@mui/icons-material/ContentCopyRounded"
import LockOutlined from "@mui/icons-material/LockOutlined"
import PublicRounded from "@mui/icons-material/PublicRounded"
import ShareRounded from "@mui/icons-material/ShareRounded"
import Alert from "@mui/material/Alert"
import Button from "@mui/material/Button"
import Chip from "@mui/material/Chip"
import Dialog from "@mui/material/Dialog"
import DialogActions from "@mui/material/DialogActions"
import DialogContent from "@mui/material/DialogContent"
import DialogTitle from "@mui/material/DialogTitle"
import Stack from "@mui/material/Stack"
import TextField from "@mui/material/TextField"
import Typography from "@mui/material/Typography"
import { useRef, useState } from "react"

export type DebateVisibilityControlsProps = {
  canMakePrivate: boolean
  error?: string
  isPending: boolean
  isPublic: boolean
  onChange: (isPublic: boolean) => void
  onClose: () => void
  shareUrl: string
}

export function DebateVisibilityControls({
  canMakePrivate,
  error,
  isPending,
  isPublic,
  onChange,
  onClose,
  shareUrl,
}: DebateVisibilityControlsProps) {
  const [open, setOpen] = useState(false)
  const [copyStatus, setCopyStatus] = useState<"copied" | "error" | null>(null)
  const copyAttemptRef = useRef(0)

  const copyLink = async () => {
    const copyAttempt = ++copyAttemptRef.current
    setCopyStatus(null)
    try {
      await navigator.clipboard.writeText(shareUrl)
      if (copyAttemptRef.current !== copyAttempt) return
      setCopyStatus("copied")
    } catch {
      if (copyAttemptRef.current !== copyAttempt) return
      setCopyStatus("error")
    }
  }

  function closeDialog() {
    if (isPending) return
    copyAttemptRef.current += 1
    setOpen(false)
    setCopyStatus(null)
    onClose()
  }

  return (
    <>
      <Stack
        direction="row"
        spacing={1}
        sx={{ alignItems: "center", justifyContent: "flex-end" }}
      >
        <Chip
          color={isPublic ? "primary" : "default"}
          icon={isPublic ? <PublicRounded /> : <LockOutlined />}
          label={isPublic ? "Public" : "Private"}
          size="small"
          sx={{ height: 30 }}
          variant="outlined"
        />
        <Button
          onClick={() => setOpen(true)}
          size="small"
          startIcon={<ShareRounded />}
          sx={{ height: 30, minHeight: 0, py: 0 }}
          variant="outlined"
        >
          Share
        </Button>
      </Stack>

      <Dialog
        fullWidth
        maxWidth="sm"
        onClose={closeDialog}
        open={open}
      >
        <DialogTitle>Share debate</DialogTitle>
        <DialogContent>
          <Stack spacing={2} sx={{ pt: 0.5 }}>
            {isPublic ? (
              <>
                <Typography color="text.secondary">
                  Anyone with this link can view the debate and follow it while
                  it runs.
                </Typography>
                <Stack direction={{ xs: "column", sm: "row" }} spacing={1}>
                  <TextField
                    fullWidth
                    label="Public debate URL"
                    slotProps={{ input: { readOnly: true } }}
                    size="small"
                    value={shareUrl}
                  />
                  <Button
                    onClick={() => void copyLink()}
                    startIcon={<ContentCopyRounded />}
                    sx={{ flexShrink: 0 }}
                    variant="contained"
                  >
                    {copyStatus === "copied" ? "Copied" : "Copy link"}
                  </Button>
                </Stack>
                {!canMakePrivate ? (
                  <Typography color="text.secondary" variant="body2">
                    A live public debate can be made private after it finishes.
                  </Typography>
                ) : null}
              </>
            ) : (
              <Stack spacing={1}>
                <Stack direction="row" spacing={1} sx={{ alignItems: "center" }}>
                  <LockOutlined color="action" />
                  <Typography sx={{ fontWeight: 650 }}>This debate is private</Typography>
                </Stack>
                <Typography color="text.secondary">
                  Make it public to create a view-only link. People with the
                  link cannot change the debate.
                </Typography>
              </Stack>
            )}

            {error === undefined ? null : <Alert severity="error">{error}</Alert>}
            {copyStatus === "error" ? (
              <Alert severity="error">The link could not be copied.</Alert>
            ) : null}
          </Stack>
        </DialogContent>
        <DialogActions>
          {isPublic && canMakePrivate ? (
            <Button
              disabled={isPending}
              onClick={() => onChange(false)}
              color="inherit"
            >
              Make private
            </Button>
          ) : null}
          <Button disabled={isPending} onClick={closeDialog} color="inherit">
            Close
          </Button>
          {!isPublic ? (
            <Button
              disabled={isPending}
              loading={isPending}
              onClick={() => onChange(true)}
              variant="contained"
            >
              Make public
            </Button>
          ) : null}
        </DialogActions>
      </Dialog>
    </>
  )
}
