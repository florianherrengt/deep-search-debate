import ExpandMore from "@mui/icons-material/ExpandMore"
import {
  Accordion,
  AccordionDetails,
  AccordionSummary,
  Typography,
} from "@mui/material"
import { useTextStream } from "../useTextStream.ts"
import { TextStreamOutput } from "./TextStreamOutput.tsx"

type GeneratedQueriesProps = {
  streamId: string | null
}

export function GeneratedQueries({ streamId }: GeneratedQueriesProps) {
  const stream = useTextStream(streamId)
  if (!streamId) return null

  return (
    <Accordion>
      <AccordionSummary expandIcon={<ExpandMore />}>
        <Typography variant="h6">Generated search queries</Typography>
      </AccordionSummary>
      <AccordionDetails>
        <TextStreamOutput
          stream={stream}
          waitingText="Waiting for query generation…"
          reasoningTestId="generated-queries-reasoning"
          textTestId="generated-queries"
        />
      </AccordionDetails>
    </Accordion>
  )
}
