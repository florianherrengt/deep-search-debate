import { useState } from "react"
import Box from "@mui/material/Box"
import Button from "@mui/material/Button"
import Chip from "@mui/material/Chip"
import CircularProgress from "@mui/material/CircularProgress"
import Dialog from "@mui/material/Dialog"
import DialogActions from "@mui/material/DialogActions"
import DialogContent from "@mui/material/DialogContent"
import DialogContentText from "@mui/material/DialogContentText"
import DialogTitle from "@mui/material/DialogTitle"
import Paper from "@mui/material/Paper"
import Stack from "@mui/material/Stack"
import Typography from "@mui/material/Typography"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"

import { RequestError } from "../../components/RequestError.tsx"
import {
  deleteOpenAiConnection,
  getOpenAiConnection,
  openAiConnectionQueryKey,
  startOpenAiConnection,
} from "../../lib/openAiConnection.ts"
import { OpenAiConnectionStatus } from "./OpenAiConnectionStatus.tsx"

const PENDING_POLL_INTERVAL_MS = 2_000

export function OpenAiConnectionSection() {
  const queryClient = useQueryClient()
  const [confirmDisconnect, setConfirmDisconnect] = useState(false)
  const connection = useQuery({
    queryKey: openAiConnectionQueryKey,
    queryFn: ({ signal }) => getOpenAiConnection(signal),
    refetchInterval: (query) =>
      query.state.data?.status === "pending"
        ? PENDING_POLL_INTERVAL_MS
        : false,
  })
  const start = useMutation({
    mutationFn: startOpenAiConnection,
    onSuccess: (snapshot) => {
      queryClient.setQueryData(openAiConnectionQueryKey, snapshot)
    },
  })
  const remove = useMutation({
    mutationFn: deleteOpenAiConnection,
    onSuccess: async (snapshot) => {
      await queryClient.cancelQueries({ queryKey: openAiConnectionQueryKey })
      queryClient.setQueryData(openAiConnectionQueryKey, snapshot)
      setConfirmDisconnect(false)
    },
  })

  return (
    <>
      <Paper sx={{ p: { xs: 2, sm: 3 } }}>
        <Stack spacing={2.5}>
          <Stack
            direction={{ xs: "column", sm: "row" }}
            spacing={1}
            sx={{ alignItems: { sm: "center" }, justifyContent: "space-between" }}
          >
            <Box>
              <Typography component="h2" variant="h6">
                OpenAI subscription
              </Typography>
              <Typography color="text.secondary" variant="body2">
                Use your ChatGPT plan for RethinkLoop model calls.
              </Typography>
            </Box>
            {connection.data === undefined ? null : (
              <Chip
                color={
                  connection.data.status === "connected"
                    ? "success"
                    : connection.data.status === "failed"
                      ? "error"
                      : connection.data.status === "pending"
                        ? "info"
                        : "default"
                }
                label={
                  connection.data.status === "pending"
                    ? "Connection pending"
                    : connection.data.status === "failed"
                      ? "Connection failed"
                      : connection.data.status === "connected"
                        ? "Connected"
                        : "Not connected"
                }
                size="small"
              />
            )}
          </Stack>

          {connection.isPending ? (
            <Stack
              aria-label="Loading OpenAI connection"
              direction="row"
              role="status"
              spacing={1.5}
              sx={{ alignItems: "center" }}
            >
              <CircularProgress size={22} />
              <Typography color="text.secondary">
                Loading connection…
              </Typography>
            </Stack>
          ) : null}
          {connection.error ? (
            <RequestError
              error={connection.error}
              onRetry={() => void connection.refetch()}
            />
          ) : null}
          {connection.data === undefined ? null : (
            <OpenAiConnectionStatus
              snapshot={connection.data}
              onCancel={() => remove.mutate()}
              onConnect={() => start.mutate()}
              onDisconnect={() => setConfirmDisconnect(true)}
              removing={remove.isPending}
              starting={start.isPending}
            />
          )}
          {start.error ? <RequestError error={start.error} /> : null}
          {remove.error ? <RequestError error={remove.error} /> : null}
        </Stack>
      </Paper>

      <Dialog
        aria-labelledby="disconnect-openai-title"
        onClose={() => {
          if (!remove.isPending) setConfirmDisconnect(false)
        }}
        open={confirmDisconnect}
      >
        <DialogTitle id="disconnect-openai-title">
          Disconnect OpenAI?
        </DialogTitle>
        <DialogContent>
          <DialogContentText>
            Your saved OpenAI connection will be removed. Future model calls
            will use RethinkLoop credits.
          </DialogContentText>
        </DialogContent>
        <DialogActions>
          <Button
            disabled={remove.isPending}
            onClick={() => setConfirmDisconnect(false)}
          >
            Keep connected
          </Button>
          <Button
            color="error"
            disabled={remove.isPending}
            onClick={() => remove.mutate()}
            variant="contained"
          >
            {remove.isPending ? "Disconnecting…" : "Disconnect"}
          </Button>
        </DialogActions>
      </Dialog>
    </>
  )
}
