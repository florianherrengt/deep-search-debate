import { AutoAwesomeRounded, LightbulbOutlined } from "@mui/icons-material"
import {
  Alert,
  Button,
  Card,
  CardContent,
  Chip,
  Stack,
  TextField,
  Typography,
} from "@mui/material"
import { useState, type SyntheticEvent } from "react"
import { Link } from "react-router-dom"

export type DebatePromptFormProps = {
  onSubmit: (prompt: string) => void
  isStarting?: boolean
  error?: string | null
  initialPrompt?: string
}

export function DebatePromptForm({
  onSubmit,
  isStarting = false,
  error = null,
  initialPrompt = "",
}: DebatePromptFormProps) {
  const [prompt, setPrompt] = useState(initialPrompt)

  function handleSubmit(event: SyntheticEvent<HTMLFormElement>) {
    event.preventDefault()
    const trimmedPrompt = prompt.trim()
    if (trimmedPrompt && !isStarting) onSubmit(trimmedPrompt)
  }

  return (
    <Stack spacing={3}>
      <Stack spacing={1}>
        <Stack direction="row" spacing={1} sx={{ alignItems: "center" }}>
          <AutoAwesomeRounded color="primary" />
          <Typography component="h1" variant="h4">
            Debate ideas
          </Typography>
        </Stack>
        <Typography color="text.secondary" variant="body1">
          Generate twelve ideas, debate every one, and let an independent judge
          choose the winner.
        </Typography>
      </Stack>

      {error && <Alert severity="error">{error}</Alert>}

      <Card variant="outlined" sx={{ maxWidth: 760 }}>
        <CardContent>
          <Stack component="form" spacing={2.5} onSubmit={handleSubmit}>
            <TextField
              autoFocus
              disabled={isStarting}
              label="What should the ideas solve?"
              minRows={4}
              multiline
              onChange={(event) => setPrompt(event.target.value)}
              placeholder="Create a product that helps independent cafés reduce food waste."
              value={prompt}
            />
            <Stack
              direction={{ xs: "column", sm: "row" }}
              spacing={1}
              sx={{ alignItems: { sm: "center" } }}
            >
              <Stack
                direction="row"
                spacing={1}
                useFlexGap
                sx={{ flexGrow: 1, flexWrap: "wrap" }}
              >
                <Chip label="12 ideas" size="small" variant="outlined" />
                <Chip label="33 matches" size="small" variant="outlined" />
                <Chip label="Runs automatically" size="small" variant="outlined" />
              </Stack>
              <Button
                disabled={isStarting || !prompt.trim()}
                loading={isStarting}
                startIcon={<AutoAwesomeRounded />}
                type="submit"
                variant="contained"
              >
                Start tournament
              </Button>
            </Stack>
          </Stack>
        </CardContent>
      </Card>

      <Button
        component={Link}
        startIcon={<LightbulbOutlined />}
        sx={{ alignSelf: "flex-start" }}
        to="/ideas"
      >
        Open the idea generator instead
      </Button>
    </Stack>
  )
}
