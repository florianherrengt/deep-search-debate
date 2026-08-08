import ArrowForwardRounded from "@mui/icons-material/ArrowForwardRounded"
import Button from "@mui/material/Button"
import Paper from "@mui/material/Paper"
import Stack from "@mui/material/Stack"
import TextField from "@mui/material/TextField"
import Typography from "@mui/material/Typography"
import type { SubmitEvent } from "react"
import { useState } from "react"
import { useNavigate } from "react-router-dom"
import { sectionTitleSx } from "../landingStyles.ts"

export function DebatePromptSection() {
  const [prompt, setPrompt] = useState("")
  const navigate = useNavigate()

  function handleSubmit(event: SubmitEvent<HTMLFormElement>) {
    event.preventDefault()
    const value = prompt.trim()
    if (value) void navigate(`/debates?prompt=${encodeURIComponent(value)}`)
  }

  return (
    <Paper
      component="section"
      sx={(theme) => {
        const palette = (theme.vars ?? theme).palette
        return {
          background: `radial-gradient(circle at 88% 20%, color-mix(in srgb, ${palette.secondary.main} 18%, transparent), transparent 34%), linear-gradient(135deg, color-mix(in srgb, ${palette.primary.main} 14%, ${palette.background.paper}), ${palette.background.paper} 58%)`,
          border: 1,
          borderColor: "divider",
          borderRadius: { xs: 2, md: 3 },
          overflow: "hidden",
          p: { xs: 3, sm: 5, md: 7 },
          position: "relative",
        }
      }}
    >
      <Stack spacing={3} sx={{ maxWidth: 760, position: "relative" }}>
        <Typography color="primary.main" variant="overline">
          Your turn
        </Typography>
        <Typography
          component="h2"
          sx={sectionTitleSx}
          variant="h2"
        >
          What should the agents debate?
        </Typography>
        <Typography color="text.secondary">
          Describe the decision, problem, or opportunity. The agents will build
          the ideas and run the debate.
        </Typography>
        <Stack component="form" onSubmit={handleSubmit} spacing={1.5}>
          <TextField
            fullWidth
            label="Your problem or decision"
            minRows={2}
            multiline
            onChange={(event) => setPrompt(event.target.value)}
            placeholder="Describe the problem or opportunity"
            value={prompt}
          />
          <Button
            disabled={!prompt.trim()}
            endIcon={<ArrowForwardRounded />}
            sx={{ alignSelf: { sm: "flex-start" } }}
            type="submit"
            variant="contained"
          >
            Start a debate
          </Button>
          <Typography color="text.secondary" variant="caption">
            Sign in required. Your debate is saved automatically.
          </Typography>
        </Stack>
      </Stack>
    </Paper>
  )
}
