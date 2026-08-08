import Button from "@mui/material/Button"
import Paper from "@mui/material/Paper"
import Stack from "@mui/material/Stack"
import TextField from "@mui/material/TextField"
import { type SubmitEvent, useState } from "react"

type PromptFormProps = {
  label: string
  onSubmit: (value: string) => void
  pending: boolean
  submitLabel: string
}

export function PromptForm({
  label,
  onSubmit,
  pending,
  submitLabel,
}: PromptFormProps) {
  const [value, setValue] = useState("")

  function handleSubmit(event: SubmitEvent<HTMLFormElement>) {
    event.preventDefault()
    const trimmedValue = value.trim()
    if (trimmedValue && !pending) onSubmit(trimmedValue)
  }

  return (
    <Paper
      component="form"
      onSubmit={handleSubmit}
      sx={{ maxWidth: 720, p: { xs: 2, sm: 2.5 }, width: "100%" }}
      variant="outlined"
    >
      <Stack spacing={2}>
        <TextField
          disabled={pending}
          label={label}
          minRows={2}
          multiline
          onChange={(event) => setValue(event.target.value)}
          value={value}
        />
        <Button
          disabled={pending || !value.trim()}
          loading={pending}
          sx={{ alignSelf: { xs: "stretch", sm: "flex-start" } }}
          type="submit"
          variant="contained"
        >
          {submitLabel}
        </Button>
      </Stack>
    </Paper>
  )
}
