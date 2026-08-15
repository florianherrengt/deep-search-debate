import Alert from "@mui/material/Alert"
import AlertTitle from "@mui/material/AlertTitle"
import Button from "@mui/material/Button"
import Stack from "@mui/material/Stack"
import Typography from "@mui/material/Typography"
import { Link } from "react-router-dom"

export function DebateStoppedAlert({
  status,
  userStopped = false,
}: {
  status: "failed" | "interrupted"
  userStopped?: boolean
}) {
  const title = userStopped
    ? "Stopped"
    : status === "interrupted"
      ? "Interrupted"
      : "Debate failed"

  return (
    <Alert severity={userStopped ? "info" : status === "interrupted" ? "warning" : "error"}>
      <AlertTitle>{title}</AlertTitle>
      <Stack spacing={1.5} sx={{ alignItems: "flex-start" }}>
        <Typography variant="body2">
          {userStopped
            ? "You stopped this debate. Completed matches and messages are kept."
            : status === "interrupted"
              ? "The debate was interrupted before it could finish. Review any completed matches, or start a new debate."
              : "The debate stopped before it could finish. Review any completed matches, or start a new debate."}
        </Typography>
        <Button color="inherit" component={Link} size="small" to="/debates">
          Start a new debate
        </Button>
      </Stack>
    </Alert>
  )
}
