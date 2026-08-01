import { Button, Paper, Stack, TextField } from "@mui/material"
import { type SubmitEvent, useState } from "react"

type ResearchRequestFormProps = {
  isSearching: boolean
  onSubmit: (researchRequest: string) => void
}

export function ResearchRequestForm({
  isSearching,
  onSubmit,
}: ResearchRequestFormProps) {
  const [researchRequest, setResearchRequest] = useState("")

  const handleSubmit = (event: SubmitEvent<HTMLFormElement>) => {
    event.preventDefault()
    const request = researchRequest.trim()
    if (!request || isSearching) return
    onSubmit(request)
  }

  return (
    <Paper component="form" onSubmit={handleSubmit} sx={{ p: 2 }}>
      <Stack spacing={2}>
        <TextField
          label="Research request"
          multiline
          minRows={2}
          value={researchRequest}
          onChange={(event) => setResearchRequest(event.target.value)}
          disabled={isSearching}
        />
        <Button type="submit" variant="contained" disabled={isSearching}>
          Start deep search
        </Button>
      </Stack>
    </Paper>
  )
}
