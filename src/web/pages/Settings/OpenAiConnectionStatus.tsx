import Alert from "@mui/material/Alert"
import AlertTitle from "@mui/material/AlertTitle"
import Box from "@mui/material/Box"
import Button from "@mui/material/Button"
import Stack from "@mui/material/Stack"
import Typography from "@mui/material/Typography"

import { ExternalLink } from "../../components/ExternalLink.tsx"
import type { OpenAiConnectionSnapshot } from "../../lib/openAiConnection.ts"

export function OpenAiConnectionStatus({
  snapshot,
  onCancel,
  onConnect,
  onDisconnect,
  removing,
  starting,
}: {
  snapshot: OpenAiConnectionSnapshot
  onCancel: () => void
  onConnect: () => void
  onDisconnect: () => void
  removing: boolean
  starting: boolean
}) {
  switch (snapshot.status) {
    case "disconnected":
      return (
        <Stack spacing={2} sx={{ alignItems: "flex-start" }}>
          <Typography color="text.secondary">
            Connect your ChatGPT account to use your OpenAI subscription for
            model calls. Search and extraction credits are still charged as
            usual.
          </Typography>
          <Button
            disabled={starting}
            onClick={onConnect}
            variant="contained"
          >
            {starting ? "Starting…" : "Connect OpenAI"}
          </Button>
        </Stack>
      )

    case "pending":
      return (
        <Stack aria-live="polite" spacing={2}>
          <Alert severity="info">
            <AlertTitle component="h3">Finish connecting with OpenAI</AlertTitle>
            Open the verification page, then enter this one-time code.
          </Alert>
          <Box>
            <Typography color="text.secondary" variant="body2">
              One-time code
            </Typography>
            <Typography
              component="code"
              sx={{
                display: "inline-block",
                fontFamily: "monospace",
                fontSize: "1.35rem",
                fontWeight: 700,
                letterSpacing: "0.08em",
                mt: 0.5,
              }}
            >
              {snapshot.userCode}
            </Typography>
            <Typography color="text.secondary" sx={{ mt: 0.75 }} variant="body2">
              Expires {new Date(snapshot.expiresAt).toLocaleString()}
            </Typography>
          </Box>
          <Stack direction={{ xs: "column", sm: "row" }} spacing={1.5}>
            <ExternalLink
              href={snapshot.verificationUrl}
              variant="button"
              buttonVariant="contained"
            >
              Open OpenAI verification
            </ExternalLink>
            <Button disabled={removing} onClick={onCancel} variant="outlined">
              {removing ? "Cancelling…" : "Cancel connection"}
            </Button>
          </Stack>
        </Stack>
      )

    case "connected":
      return (
        <Stack spacing={2} sx={{ alignItems: "flex-start" }}>
          <Alert severity="success">
            <AlertTitle component="h3">OpenAI is connected</AlertTitle>
            New model calls will use your OpenAI subscription. RethinkLoop will
            not charge product credits for those model calls.
          </Alert>
          <Button color="error" onClick={onDisconnect} variant="outlined">
            Disconnect OpenAI
          </Button>
        </Stack>
      )

    case "failed":
      return (
        <Stack spacing={2} sx={{ alignItems: "flex-start" }}>
          <Alert severity="error">
            <AlertTitle component="h3">
              OpenAI connection needs attention
            </AlertTitle>
            {snapshot.message}
          </Alert>
          <Stack direction={{ xs: "column", sm: "row" }} spacing={1.5}>
            <Button
              disabled={starting}
              onClick={onConnect}
              variant="contained"
            >
              {starting ? "Retrying…" : "Retry connection"}
            </Button>
            <Button color="error" onClick={onDisconnect} variant="outlined">
              Disconnect OpenAI
            </Button>
          </Stack>
        </Stack>
      )
  }
}
