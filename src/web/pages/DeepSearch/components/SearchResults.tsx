import { Stack, Typography } from "@mui/material"
import type { DeepSearchSearchState } from "../../../lib/deepSearchState.ts"
import { SearchResultsGroup } from "./SearchResultsGroup.tsx"

type SearchResultsProps = {
  searches: DeepSearchSearchState[]
}

export function SearchResults({ searches }: SearchResultsProps) {
  if (searches.length === 0) return null
  const sectionId = `research-results-${searches[0]?.round ?? 0}`

  return (
    <Stack component="section" spacing={2} aria-labelledby={sectionId}>
      <Stack spacing={0.5}>
        <Typography id={sectionId} component="h3" variant="h5">
          Research results
        </Typography>
        <Typography color="text.secondary">
          Findings are organized by the search query that produced them.
        </Typography>
      </Stack>

      {searches.map((search, index) => (
        <SearchResultsGroup
          key={`${search.round}:${search.query}`}
          search={search}
          position={
            searches
              .slice(0, index + 1)
              .filter(({ round }) => round === search.round).length
          }
        />
      ))}
    </Stack>
  )
}
