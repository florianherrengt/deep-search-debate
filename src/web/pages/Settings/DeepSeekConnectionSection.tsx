import { useState, type SyntheticEvent } from "react"
import Alert from "@mui/material/Alert"
import Box from "@mui/material/Box"
import Button from "@mui/material/Button"
import Chip from "@mui/material/Chip"
import CircularProgress from "@mui/material/CircularProgress"
import Paper from "@mui/material/Paper"
import Stack from "@mui/material/Stack"
import TextField from "@mui/material/TextField"
import Typography from "@mui/material/Typography"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"

import { RequestError } from "../../components/RequestError.tsx"
import {
  deepSeekConnectionQueryKey,
  deleteDeepSeekKey,
  getDeepSeekConnection,
  saveDeepSeekKey,
} from "../../lib/deepSeekConnection.ts"
import { llmModelSettingsQueryKey } from "../../lib/llmModelSettings.ts"

export function DeepSeekConnectionSection() {
  const queryClient = useQueryClient()
  const [apiKey, setApiKey] = useState("")
  const connection = useQuery({
    queryKey: deepSeekConnectionQueryKey,
    queryFn: ({ signal }) => getDeepSeekConnection(signal),
  })
  const save = useMutation({
    mutationFn: saveDeepSeekKey,
    onSuccess: async (snapshot) => {
      queryClient.setQueryData(deepSeekConnectionQueryKey, snapshot)
      await queryClient.invalidateQueries({ queryKey: llmModelSettingsQueryKey })
      setApiKey("")
    },
  })
  const remove = useMutation({
    mutationFn: deleteDeepSeekKey,
    onSuccess: async (snapshot) => {
      queryClient.setQueryData(deepSeekConnectionQueryKey, snapshot)
      await queryClient.invalidateQueries({ queryKey: llmModelSettingsQueryKey })
    },
  })

  function submit(event: SyntheticEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!apiKey.trim() || save.isPending) return
    save.mutate(apiKey)
  }

  return (
    <Paper sx={{ p: { xs: 2, sm: 3 } }}>
      <Stack spacing={2.5}>
        <Stack
          direction={{ xs: "column", sm: "row" }}
          spacing={1}
          sx={{ alignItems: { sm: "center" }, justifyContent: "space-between" }}
        >
          <Box>
            <Typography component="h2" variant="h6">
              DeepSeek API key
            </Typography>
            <Typography color="text.secondary" variant="body2">
              Add your key to load and use DeepSeek models. The saved key is never shown.
            </Typography>
          </Box>
          {connection.data === undefined ? null : (
            <Chip
              color={connection.data.hasKey ? "success" : "default"}
              label={connection.data.hasKey ? "Key saved" : "No key saved"}
              size="small"
            />
          )}
        </Stack>

        {connection.isPending ? (
          <Stack aria-label="Loading DeepSeek connection" direction="row" role="status" spacing={1.5} sx={{ alignItems: "center" }}>
            <CircularProgress size={22} />
            <Typography color="text.secondary">Loading connection…</Typography>
          </Stack>
        ) : null}
        {connection.error ? (
          <RequestError error={connection.error} onRetry={() => void connection.refetch()} />
        ) : null}

        <Stack component="form" onSubmit={submit} spacing={1.5}>
          <TextField
            autoComplete="new-password"
            fullWidth
            label={connection.data?.hasKey ? "Replace API key" : "API key"}
            onChange={(event) => setApiKey(event.target.value)}
            type="password"
            value={apiKey}
          />
          <Stack direction={{ xs: "column", sm: "row" }} spacing={1}>
            <Button disabled={!apiKey.trim() || save.isPending} type="submit" variant="contained">
              {save.isPending ? "Saving…" : connection.data?.hasKey ? "Replace key" : "Save key"}
            </Button>
            {connection.data?.hasKey ? (
              <Button color="error" disabled={remove.isPending} onClick={() => remove.mutate()} variant="outlined">
                {remove.isPending ? "Removing…" : "Remove key"}
              </Button>
            ) : null}
          </Stack>
        </Stack>
        {save.error ? <RequestError error={save.error} /> : null}
        {remove.error ? <RequestError error={remove.error} /> : null}
        {save.isSuccess ? <Alert severity="success">DeepSeek API key saved.</Alert> : null}
        {remove.isSuccess ? <Alert severity="success">DeepSeek API key removed.</Alert> : null}
      </Stack>
    </Paper>
  )
}
