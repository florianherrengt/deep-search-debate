import { Stack, Typography } from "@mui/material"
import type { DeepSearchSearchState } from "../../../lib/deepSearchState.ts"
import { SearchResultsGroup } from "./SearchResultsGroup.tsx"

type SearchResultsProps = {
  searches: DeepSearchSearchState[]
}

export function SearchResults({ searches }: SearchResultsProps) {
  if (searches.length === 0) return null

  return (
    <Stack component="section" spacing={2} aria-labelledby="research-results">
      <Stack spacing={0.5}>
        <Typography id="research-results" component="h2" variant="h5">
          Research results
        </Typography>
        <Typography color="text.secondary">
          Findings are organized by the search query that produced them.
        </Typography>
      </Stack>

      {searches.map((search, index) => (
        <SearchResultsGroup
          key={search.query}
          search={search}
          position={index + 1}
        />
      ))}
    </Stack>
  )
}
