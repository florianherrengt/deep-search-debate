import { Stack, Typography } from "@mui/material"
import { ExternalLink } from "../../../components/ExternalLink.tsx"
import { getPromptExcerpt } from "../../../lib/promptPresentation.ts"
import type { IdeaResearchState } from "../ideaJobState.ts"

function ResearchLink({ research }: { research: IdeaResearchState }) {
  // Deep-search rendering stays owned by its existing route. The new tab lets
  // users follow a search without replacing or duplicating the idea pipeline.
  return (
    <Stack spacing={0.25}>
      <ExternalLink
        href={`/deep-search/${research.slug}`}
        sx={{ overflowWrap: "anywhere" }}
      >
        {research.title}
      </ExternalLink>
      <Typography color="text.secondary" variant="body2">
        {getPromptExcerpt(research.researchRequest)}
      </Typography>
    </Stack>
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
