import Alert from "@mui/material/Alert"
import Button from "@mui/material/Button"
import Stack from "@mui/material/Stack"
import Typography from "@mui/material/Typography"
import { Link } from "react-router-dom"

export function DebateStoppedAlert() {
  return (
    <Alert severity="error">
      <Stack spacing={1.5} sx={{ alignItems: "flex-start" }}>
        <Typography variant="body2">
          The debate stopped before it could finish. Review any completed
          matches, or start a new debate.
        </Typography>
        <Button color="inherit" component={Link} size="small" to="/debates">
          Start a new debate
        </Button>
      </Stack>
    </Alert>
  )
}
