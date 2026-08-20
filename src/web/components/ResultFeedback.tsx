import ThumbDownRounded from "@mui/icons-material/ThumbDownRounded"
import ThumbUpRounded from "@mui/icons-material/ThumbUpRounded"
import Alert from "@mui/material/Alert"
import Button from "@mui/material/Button"
import Dialog from "@mui/material/Dialog"
import DialogActions from "@mui/material/DialogActions"
import DialogContent from "@mui/material/DialogContent"
import DialogTitle from "@mui/material/DialogTitle"
import IconButton from "@mui/material/IconButton"
import Stack from "@mui/material/Stack"
import TextField from "@mui/material/TextField"
import Tooltip from "@mui/material/Tooltip"
import Typography from "@mui/material/Typography"
import { useState } from "react"
import type { ResultFeedback as ResultFeedbackState } from "../lib/resultFeedback.ts"

const maximumFeedbackLength = 5_000

export function ResultFeedback({
  error,
  feedback,
  iconOnly = false,
  onRatingChange,
  onSubmitText,
  pending,
}: {
  error?: string
  feedback: ResultFeedbackState
  iconOnly?: boolean
  onRatingChange: (rating: boolean) => Promise<void>
  onSubmitText: (text: string) => Promise<void>
  pending: boolean
}) {
  const [dialogOpen, setDialogOpen] = useState(false)
  const [draft, setDraft] = useState("")
  const trimmedDraft = draft.trim()
  const draftInvalid =
    trimmedDraft.length === 0 || trimmedDraft.length > maximumFeedbackLength

  const selectRating = async (rating: boolean) => {
    if (rating === feedback.rating) {
      if (!rating && !feedback.hasWrittenFeedback) setDialogOpen(true)
      return
    }

    try {
      await onRatingChange(rating)
      if (!rating) setDialogOpen(true)
    } catch {
      // The route-owned mutation exposes the request error through `error`.
    }
  }

  const submitText = async () => {
    if (draftInvalid) return
    try {
      await onSubmitText(trimmedDraft)
      setDialogOpen(false)
      setDraft("")
    } catch {
      // Keep the dialog and draft intact while the route reports the error.
    }
  }

  return (
    <Stack
      component="section"
      spacing={iconOnly ? 0 : 1.25}
      aria-label={iconOnly ? "Result feedback" : undefined}
      aria-labelledby={iconOnly ? undefined : "result-feedback-heading"}
    >
      {!iconOnly && (
        <Typography component="h2" id="result-feedback-heading" variant="h6">
          Was this result helpful?
        </Typography>
      )}
      <Stack direction="row" spacing={1}>
        <Tooltip title="Helpful">
          <span>
            <IconButton
              aria-label="Thumbs up"
              aria-pressed={feedback.rating === true}
              color={feedback.rating === true ? "primary" : "default"}
              disabled={pending}
              onClick={() => void selectRating(true)}
              size={iconOnly ? "small" : "medium"}
              sx={
                feedback.rating === true
                  ? { bgcolor: "primary.main", color: "primary.contrastText", "&:hover": { bgcolor: "primary.dark" } }
                  : undefined
              }
            >
              <ThumbUpRounded />
            </IconButton>
          </span>
        </Tooltip>
        <Tooltip title="Not helpful">
          <span>
            <IconButton
              aria-label="Thumbs down"
              aria-pressed={feedback.rating === false}
              color={feedback.rating === false ? "error" : "default"}
              disabled={pending}
              onClick={() => void selectRating(false)}
              size={iconOnly ? "small" : "medium"}
              sx={
                feedback.rating === false
                  ? { bgcolor: "error.main", color: "error.contrastText", "&:hover": { bgcolor: "error.dark" } }
                  : undefined
              }
            >
              <ThumbDownRounded />
            </IconButton>
          </span>
        </Tooltip>
      </Stack>
      {error && !dialogOpen && <Alert severity="error">{error}</Alert>}

      <Dialog
        fullWidth
        maxWidth="sm"
        onClose={() => {
          if (!pending) setDialogOpen(false)
        }}
        open={dialogOpen}
      >
        <DialogTitle>What could be improved?</DialogTitle>
        <DialogContent>
          <Stack spacing={1.5} sx={{ pt: 0.5 }}>
            <Typography color="text.secondary" variant="body2">
              Written feedback is optional, but it helps us improve future results.
            </Typography>
            <TextField
              autoFocus
              error={draft.length > maximumFeedbackLength}
              fullWidth
              helperText={`${draft.length.toLocaleString()} / ${maximumFeedbackLength.toLocaleString()}`}
              label="Feedback"
              minRows={6}
              multiline
              onChange={(event) => setDraft(event.target.value)}
              slotProps={{
                formHelperText: { sx: { textAlign: "right" } },
                htmlInput: { maxLength: maximumFeedbackLength },
              }}
              value={draft}
            />
            {error && <Alert severity="error">{error}</Alert>}
          </Stack>
        </DialogContent>
        <DialogActions>
          <Button disabled={pending} onClick={() => setDialogOpen(false)}>
            Not now
          </Button>
          <Button
            disabled={draftInvalid || pending}
            onClick={() => void submitText()}
            variant="contained"
          >
            Submit feedback
          </Button>
        </DialogActions>
      </Dialog>
    </Stack>
  )
}
