import OpenInNew from "@mui/icons-material/OpenInNew"
import { Link, Stack } from "@mui/material"
import type { IdeaResearchState } from "../ideaJobState.ts"

function ResearchLink({ research }: { research: IdeaResearchState }) {
  // Deep-search rendering stays owned by its existing route. The new tab lets
  // users follow a search without replacing or duplicating the idea pipeline.
  return (
    <Link
      href={`/deep-search/${research.deepSearchJobId}`}
      target="_blank"
      rel="noopener noreferrer"
      sx={{ overflowWrap: "anywhere" }}
    >
      {research.researchRequest}
      <OpenInNew
        aria-hidden="true"
        fontSize="inherit"
        sx={{ ml: 0.5, verticalAlign: "text-bottom" }}
      />
    </Link>
  )
}

export function ResearchProgress({
  research,
}: {
  research: IdeaResearchState[]
}) {
  return (
    <Stack spacing={1}>
      {research.map((item) => (
        <ResearchLink key={item.deepSearchJobId} research={item} />
      ))}
    </Stack>
  )
}
