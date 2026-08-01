import { Stack } from "@mui/material"
import type { DeepSearchSearchState } from "../deepSearchState.ts"
import { SearchResultsGroup } from "./SearchResultsGroup.tsx"

type SearchResultsProps = {
  searches: DeepSearchSearchState[]
}

export function SearchResults({ searches }: SearchResultsProps) {
  return (
    <Stack spacing={3}>
      {searches.map((search) => (
        <SearchResultsGroup key={search.query} search={search} />
      ))}
    </Stack>
  )
}
