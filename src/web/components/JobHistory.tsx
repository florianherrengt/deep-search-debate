import CircularProgress from "@mui/material/CircularProgress"
import List from "@mui/material/List"
import Paper from "@mui/material/Paper"
import Stack from "@mui/material/Stack"
import Typography from "@mui/material/Typography"
import type { ReactNode } from "react"
import { JobHistoryListItem } from "./JobHistoryListItem.tsx"
import { RequestError } from "./RequestError.tsx"

type JobHistoryEntry = {
  createdAt: Date
  id: string
  label: string
  prompt: string
  status: ReactNode
  to: string
}

type JobHistoryProps = {
  emptyMessage: string
  error: unknown
  heading: string
  headingId: string
  isPending: boolean
  items?: readonly JobHistoryEntry[]
  onRetry: () => void
}

function formatCreatedAt(value: Date): string {
  return new Intl.DateTimeFormat(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(value)
}

export function JobHistory({
  emptyMessage,
  error,
  heading,
  headingId,
  isPending,
  items,
  onRetry,
}: JobHistoryProps) {
  return (
    <Stack component="section" spacing={1.5} aria-labelledby={headingId}>
      <Typography id={headingId} component="h2" variant="h5">
        {heading}
      </Typography>
      {isPending && <CircularProgress size={24} />}
      {error ? <RequestError error={error} onRetry={onRetry} /> : null}
      {!isPending && !error && items?.length === 0 ? (
        <Typography color="text.secondary">{emptyMessage}</Typography>
      ) : null}
      {items && items.length > 0 ? (
        <Paper variant="outlined">
          <List disablePadding>
            {items.map((item) => (
              <JobHistoryListItem
                key={item.id}
                date={formatCreatedAt(item.createdAt)}
                label={item.label}
                prompt={item.prompt}
                status={item.status}
                to={item.to}
              />
            ))}
          </List>
        </Paper>
      ) : null}
    </Stack>
  )
}
