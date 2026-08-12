import { List, ListItem, ListItemText, Typography } from "@mui/material"
import { GenerationOutput } from "../../../components/streaming/GenerationOutput.tsx"
import type { DeepSearchResultState } from "../../../lib/deepSearchState.ts"

type SourceSelectionProps = {
  query: string
  results: DeepSearchResultState[]
  streamId: string
}

/** Renders selected source titles while retaining the selector's reasoning stream. */
export function SourceSelection({
  query,
  results,
  streamId,
}: SourceSelectionProps) {
  const selectionPending = results.some(
    ({ selection }) => selection === "pending",
  )
  const selectedResults = results.filter(
    ({ selection }) => selection === "selected",
  )

  return (
    <GenerationOutput
      headingComponent="h6"
      showText={false}
      streamId={streamId}
      title="Source selection"
      waitingText="Selecting sources…"
      testId={`selection-${query}`}
    >
      {selectionPending ? (
        <Typography color="text.secondary" variant="body2">
          Selecting sources…
        </Typography>
      ) : selectedResults.length > 0 ? (
        <List
          component="ol"
          data-testid={`selection-${query}`}
          disablePadding
          sx={{ listStyle: "decimal", maxWidth: "85ch", pl: 3 }}
        >
          {selectedResults.map((result) => (
            <ListItem
              key={result.link}
              disableGutters
              sx={{ display: "list-item", py: 0.25 }}
            >
              <ListItemText
                primary={result.title}
                slotProps={{ primary: { variant: "body2" } }}
              />
            </ListItem>
          ))}
        </List>
      ) : (
        <Typography color="text.secondary" variant="body2">
          No sources selected.
        </Typography>
      )}
    </GenerationOutput>
  )
}
