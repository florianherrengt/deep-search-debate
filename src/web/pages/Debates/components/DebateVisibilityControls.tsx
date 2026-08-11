import ContentCopyRounded from "@mui/icons-material/ContentCopyRounded"
import Alert from "@mui/material/Alert"
import Button from "@mui/material/Button"
import Card from "@mui/material/Card"
import CardContent from "@mui/material/CardContent"
import FormControlLabel from "@mui/material/FormControlLabel"
import Stack from "@mui/material/Stack"
import Switch from "@mui/material/Switch"
import TextField from "@mui/material/TextField"
import Typography from "@mui/material/Typography"
import { useState } from "react"

export type DebateVisibilityControlsProps = {
  canMakePrivate: boolean
  error?: string
  isPending: boolean
  isPublic: boolean
  onChange: (isPublic: boolean) => void
  shareUrl: string
}

export function DebateVisibilityControls({
  canMakePrivate,
  error,
  isPending,
  isPublic,
  onChange,
  shareUrl,
}: DebateVisibilityControlsProps) {
  const [copyStatus, setCopyStatus] = useState<"copied" | "error" | null>(null)

  const copyLink = async () => {
    setCopyStatus(null)
    try {
      await navigator.clipboard.writeText(shareUrl)
      setCopyStatus("copied")
    } catch {
      setCopyStatus("error")
    }
  }

  return (
    <Card variant="outlined">
      <CardContent>
        <Stack spacing={1.5}>
          <Stack
            direction={{ xs: "column", sm: "row" }}
            spacing={1}
            sx={{ alignItems: { sm: "center" } }}
          >
            <FormControlLabel
              control={
                <Switch
                  checked={isPublic}
                  disabled={isPending || (isPublic && !canMakePrivate)}
                  onChange={(event) => onChange(event.target.checked)}
                />
              }
              label="Public debate"
              sx={{ flexGrow: 1 }}
            />
            <Typography color="text.secondary" variant="body2">
              {isPublic
                ? canMakePrivate
                  ? "Anyone with the link can open this debate."
                  : "A live public debate can be made private after it finishes."
                : "Only you can open this debate."}
            </Typography>
          </Stack>

          {isPublic ? (
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
                variant="outlined"
              >
                {copyStatus === "copied" ? "Copied" : "Copy link"}
              </Button>
            </Stack>
          ) : null}

          {error === undefined ? null : <Alert severity="error">{error}</Alert>}
          {copyStatus === "error" ? (
            <Alert severity="error">The link could not be copied.</Alert>
          ) : null}
        </Stack>
      </CardContent>
    </Card>
  )
}
