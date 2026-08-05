import { Button, Paper, Stack, TextField } from "@mui/material"
import { type SubmitEvent, useState } from "react"

export function IdeaPromptForm({
  isGenerating,
  onSubmit,
}: {
  isGenerating: boolean
  onSubmit: (prompt: string) => void
}) {
  const [prompt, setPrompt] = useState("")

  const handleSubmit = (event: SubmitEvent<HTMLFormElement>) => {
    event.preventDefault()
    const value = prompt.trim()
    if (value && !isGenerating) onSubmit(value)
  }

  return (
    <Paper
      component="form"
      onSubmit={handleSubmit}
      variant="outlined"
      sx={{ maxWidth: 720, p: { xs: 2, sm: 2.5 }, width: "100%" }}
    >
      <Stack spacing={2}>
        <TextField
          label="What should we generate ideas for?"
          multiline
          minRows={2}
          value={prompt}
          onChange={(event) => setPrompt(event.target.value)}
          disabled={isGenerating}
        />
        <Button
          disabled={isGenerating}
          sx={{ alignSelf: { xs: "stretch", sm: "flex-start" } }}
          type="submit"
          variant="contained"
        >
          Generate 12 ideas
        </Button>
      </Stack>
    </Paper>
  )
}
