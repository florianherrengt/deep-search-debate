import ExpandMore from "@mui/icons-material/ExpandMore"
import {
  Accordion,
  AccordionDetails,
  AccordionSummary,
  Chip,
  Divider,
  Paper,
  Stack,
  Typography,
} from "@mui/material"
import type { DeepSearchSearchState } from "../deepSearchState.ts"
import { QuerySummary } from "./QuerySummary.tsx"
import { SearchResultCard } from "./SearchResultCard.tsx"

type SearchResultsGroupProps = {
  search: DeepSearchSearchState
  position: number
}

function pluralize(count: number, singular: string): string {
  return `${count} ${singular}${count === 1 ? "" : "s"}`
}

export function SearchResultsGroup({
  search,
  position,
}: SearchResultsGroupProps) {
  const exploredCount = search.results.filter(
    ({ selection }) => selection === "selected",
  ).length

  return (
    <Paper component="section" variant="outlined" sx={{ overflow: "hidden" }}>
      <Stack spacing={2} sx={{ p: { xs: 2, sm: 3 } }}>
        <Stack
          direction={{ xs: "column", sm: "row" }}
          spacing={1}
          sx={{ justifyContent: "space-between", alignItems: { sm: "center" } }}
        >
          <Typography variant="overline" color="text.secondary">
            Search {position}
          </Typography>
          <Stack direction="row" spacing={1} useFlexGap sx={{ flexWrap: "wrap" }}>
            <Chip
              size="small"
              variant="outlined"
              label={pluralize(search.results.length, "result")}
            />
            <Chip
              size="small"
              color="primary"
              variant="outlined"
              label={`${exploredCount} explored in depth`}
            />
          </Stack>
        </Stack>

        <Typography component="h3" variant="h5" sx={{ overflowWrap: "anywhere" }}>
          {search.query}
        </Typography>

        <QuerySummary
          query={search.query}
          streamId={search.querySummaryStreamId}
        />
      </Stack>

      <Divider />

      <Accordion disableGutters elevation={0} square>
        <AccordionSummary
          expandIcon={<ExpandMore />}
          aria-label={`Show source results for ${search.query}`}
        >
          <Stack spacing={0.25}>
            <Typography component="h4" variant="subtitle1">
              Source results
            </Typography>
            <Typography variant="caption" color="text.secondary">
              Open the listings and source-level findings for this search.
            </Typography>
          </Stack>
        </AccordionSummary>
        <AccordionDetails sx={{ pt: 0, px: { xs: 2, sm: 3 }, pb: 3 }}>
          <Stack spacing={1.5}>
            {search.results.map((result) => (
              <SearchResultCard key={result.link} result={result} />
            ))}
          </Stack>
        </AccordionDetails>
      </Accordion>
    </Paper>
  )
}
