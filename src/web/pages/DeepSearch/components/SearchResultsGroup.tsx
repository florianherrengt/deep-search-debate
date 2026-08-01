import ExpandMore from "@mui/icons-material/ExpandMore"
import {
  Accordion,
  AccordionDetails,
  AccordionSummary,
  Stack,
  Typography,
} from "@mui/material"
import type { DeepSearchSearchState } from "../deepSearchState.ts"
import { QuerySummary } from "./QuerySummary.tsx"
import { SearchResultCard } from "./SearchResultCard.tsx"
import { SelectionOutput } from "./SelectionOutput.tsx"

type SearchResultsGroupProps = {
  search: DeepSearchSearchState
}

export function SearchResultsGroup({ search }: SearchResultsGroupProps) {
  return (
    <Stack component="section" spacing={1}>
      <Accordion>
        <AccordionSummary expandIcon={<ExpandMore />}>
          <Typography variant="h6">Results for {search.query}</Typography>
        </AccordionSummary>
        <AccordionDetails>
          <Stack spacing={2}>
            <QuerySummary
              query={search.query}
              streamId={search.querySummaryStreamId}
            />
            <SelectionOutput
              query={search.query}
              streamId={search.selectionStreamId}
            />
            <Stack spacing={1}>
              {search.results.map((result) => (
                <SearchResultCard
                  key={result.link}
                  result={result}
                />
              ))}
            </Stack>
          </Stack>
        </AccordionDetails>
      </Accordion>
    </Stack>
  )
}
