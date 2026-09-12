import { CircularProgress, Paper, Stack, Typography } from "@mui/material"
import { ExternalLink } from "../../../components/ExternalLink.tsx"
import { TextStreamOutput } from "../../../components/streaming/TextStreamOutput.tsx"
import { useTextStream } from "../../../components/streaming/useTextStream.ts"
import type { DeepSearchLinkedSourceState } from "../../../lib/deepSearchState.ts"
import { PageSummary } from "./PageSummary.tsx"

function LinkedSource({ source, active }: {
  source: DeepSearchLinkedSourceState
  active: boolean
}) {
  const stream = useTextStream(source.selectionStreamId)
  const selecting = active && source.links === undefined && stream.status !== "error"

  return (
    <Stack spacing={1.5}>
      <Typography component="h4" variant="subtitle1" sx={{ overflowWrap: "anywhere" }}>
        Linked from <ExternalLink href={source.sourceUrl}>{source.sourceUrl}</ExternalLink>
      </Typography>
      {source.selectionStreamId && (
        <TextStreamOutput
          showText={false}
          stream={!active && stream.status !== "error" ? { ...stream, status: "completed" } : stream}
          waitingText="Selecting linked sources…"
          textTestId={`linked-selection-${source.sourceUrl}`}
        />
      )}
      {source.links === undefined ? (
        <Stack direction="row" spacing={1} sx={{ alignItems: "center" }}>
          {selecting && <CircularProgress aria-label="Selecting linked sources" size={16} />}
          <Typography color="text.secondary" variant="body2">
            {selecting ? "Selecting linked sources…" : "Link selection did not finish."}
          </Typography>
        </Stack>
      ) : source.links.length === 0 ? (
        <Typography color="text.secondary" variant="body2">No linked sources selected.</Typography>
      ) : source.links.map((link) => (
        <Paper key={link.url} variant="outlined" sx={{ p: 2 }}>
          <Stack spacing={0.5}>
            <Typography component="h5" variant="subtitle1" sx={{ overflowWrap: "anywhere" }}>
              <ExternalLink href={link.url}>{link.title}</ExternalLink>
            </Typography>
            <Typography color="text.secondary" variant="caption" sx={{ overflowWrap: "anywhere" }}>
              {link.url}
            </Typography>
          </Stack>
          <PageSummary summary={link.summary} active={active} />
        </Paper>
      ))}
    </Stack>
  )
}

/** Shows pages reached through source links separately from search listings. */
export function LinkedSources({ sources, active }: {
  sources: DeepSearchLinkedSourceState[]
  active: boolean
}) {
  if (sources.length === 0) return null
  return (
    <Stack component="section" aria-labelledby="linked-sources-heading" spacing={2}>
      <Stack spacing={0.5}>
        <Typography id="linked-sources-heading" component="h3" variant="h5">Linked sources</Typography>
        <Typography color="text.secondary">Pages followed from links in the explored sources.</Typography>
      </Stack>
      {sources.map((source) => <LinkedSource key={source.sourceUrl} source={source} active={active} />)}
    </Stack>
  )
}
