import {
  AutoAwesomeRounded,
  ExpandMoreRounded,
  LightbulbOutlined,
  TuneRounded,
} from "@mui/icons-material"
import {
  Alert,
  Button,
  Card,
  CardContent,
  Collapse,
  MenuItem,
  Stack,
  TextField,
  Typography,
} from "@mui/material"
import { useState, type SyntheticEvent } from "react"
import { Link } from "react-router-dom"

export type DebatePromptFormProps = {
  onSubmit: (input: {
    prompt: string
    numberOfIdeas: number
  }) => void
  isStarting?: boolean
  error?: string | null
  initialPrompt?: string
  initialNumberOfIdeas?: number
}

const ideaCountOptions = [6, 8] as const

export function DebatePromptForm({
  onSubmit,
  isStarting = false,
  error = null,
  initialPrompt = "",
  initialNumberOfIdeas = 8,
}: DebatePromptFormProps) {
  const [prompt, setPrompt] = useState(initialPrompt)
  const [numberOfIdeas, setNumberOfIdeas] = useState(initialNumberOfIdeas)
  const [advancedOptionsOpen, setAdvancedOptionsOpen] = useState(false)
  const ideaCountIsValid = ideaCountOptions.some(
    (option) => option === numberOfIdeas,
  )
  const handedOffPrompt = initialPrompt.trim().length > 0

  function handleSubmit(event: SyntheticEvent<HTMLFormElement>) {
    event.preventDefault()
    const trimmedPrompt = prompt.trim()
    if (trimmedPrompt && ideaCountIsValid && !isStarting) {
      onSubmit({ prompt: trimmedPrompt, numberOfIdeas })
    }
  }

  return (
    <Stack spacing={3}>
      <Stack spacing={1}>
        <Stack direction="row" spacing={1} sx={{ alignItems: "center" }}>
          <AutoAwesomeRounded color="primary" />
          <Typography component="h1" variant="h4">
            {handedOffPrompt ? "Review and start your debate" : "Debate ideas"}
          </Typography>
        </Stack>
        <Typography color="text.secondary" variant="body1">
          {handedOffPrompt
            ? "Your question is ready. Edit it if needed, then start the debate."
            : "Describe a problem or decision. The agents will research competing ideas, test them head-to-head, and choose a winner."}
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
              minRows={handedOffPrompt ? 2 : 3}
              multiline
              onChange={(event) => setPrompt(event.target.value)}
              placeholder="Create a product that helps independent cafés reduce food waste."
              value={prompt}
            />
            <Button
              aria-expanded={advancedOptionsOpen}
              color="inherit"
              disabled={isStarting}
              endIcon={
                <ExpandMoreRounded
                  sx={{
                    transform: advancedOptionsOpen ? "rotate(180deg)" : undefined,
                  }}
                />
              }
              onClick={() => setAdvancedOptionsOpen((current) => !current)}
              startIcon={<TuneRounded />}
              sx={{ alignSelf: "flex-start", px: 0.5 }}
            >
              Advanced options
            </Button>
            <Collapse in={advancedOptionsOpen} unmountOnExit>
              <TextField
                disabled={isStarting}
                error={!ideaCountIsValid}
                fullWidth
                helperText="Choose how many candidate ideas enter the tournament."
                label="Candidate ideas"
                onChange={(event) => setNumberOfIdeas(Number(event.target.value))}
                select
                size="small"
                value={numberOfIdeas}
              >
                {ideaCountOptions.map((option) => (
                  <MenuItem key={option} value={option}>
                    {option} ideas
                  </MenuItem>
                ))}
              </TextField>
            </Collapse>
            <Stack
              direction={{ xs: "column", sm: "row" }}
              spacing={1}
              sx={{ alignItems: { sm: "center" } }}
            >
              <Typography
                color="text.secondary"
                sx={{ flexGrow: 1 }}
                variant="body2"
              >
                Private by default. You can share it after it starts.
              </Typography>
              <Button
                disabled={isStarting || !prompt.trim() || !ideaCountIsValid}
                loading={isStarting}
                startIcon={<AutoAwesomeRounded />}
                type="submit"
                variant="contained"
              >
                Start a debate
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
        Only generate options
      </Button>
    </Stack>
  )
}
