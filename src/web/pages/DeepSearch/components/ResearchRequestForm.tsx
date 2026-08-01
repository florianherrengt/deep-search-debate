import { Button, Paper, Stack, TextField } from "@mui/material"
import type { SubmitEventHandler } from "react"

type ResearchRequestFormProps = {
  researchRequest: string
  isSearching: boolean
  onResearchRequestChange: (value: string) => void
  onSubmit: SubmitEventHandler<HTMLFormElement>
}

export function ResearchRequestForm({
  researchRequest,
  isSearching,
  onResearchRequestChange,
  onSubmit,
}: ResearchRequestFormProps) {
  return (
    <Paper component="form" onSubmit={onSubmit} sx={{ p: 2 }}>
      <Stack spacing={2}>
        <TextField
          label="Research request"
          multiline
          minRows={2}
          value={researchRequest}
          onChange={(event) => onResearchRequestChange(event.target.value)}
          disabled={isSearching}
        />
        <Button type="submit" variant="contained" disabled={isSearching}>
          Start deep search
        </Button>
      </Stack>
    </Paper>
  )
}
