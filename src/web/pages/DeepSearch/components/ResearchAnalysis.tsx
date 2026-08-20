import Box from "@mui/material/Box"
import Link from "@mui/material/Link"
import List from "@mui/material/List"
import ListItem from "@mui/material/ListItem"
import Paper from "@mui/material/Paper"
import Stack from "@mui/material/Stack"
import Typography from "@mui/material/Typography"

import type { ResearchAnalysis as ResearchAnalysisResult } from "../../../lib/deepSearchJobs.ts"

type AnalysisItem = {
  title: string
  description: string
  sources?: string[]
}

type AnalysisCategory = {
  id: string
  title: string
  description: string
  emptyMessage: string
  items: AnalysisItem[]
}

function uniqueItems(items: AnalysisItem[]): AnalysisItem[] {
  const keys = new Set<string>()
  return items.filter((item) => {
    const key = JSON.stringify(item)
    if (keys.has(key)) return false
    keys.add(key)
    return true
  })
}

function sourceLabel(source: string): string {
  return new URL(source).hostname.replace(/^www\./, "")
}

function AnalysisCategory({ category }: { category: AnalysisCategory }) {
  const items = uniqueItems(category.items)
  return (
    <Paper
      aria-labelledby={`${category.id}-heading`}
      component="section"
      sx={{ p: { xs: 2, sm: 2.5 } }}
      variant="outlined"
    >
      <Stack spacing={0.5}>
        <Typography component="h3" id={`${category.id}-heading`} variant="h6">
          {category.title}
        </Typography>
        <Typography color="text.secondary" variant="body2">
          {category.description}
        </Typography>
      </Stack>
      {items.length === 0 ? (
        <Typography color="text.secondary" sx={{ mt: 2 }} variant="body2">
          {category.emptyMessage}
        </Typography>
      ) : (
        <List disablePadding>
          {items.map((item) => {
            const sources = [...new Set(item.sources ?? [])]
            return (
              <ListItem
                component="li"
                disableGutters
                key={JSON.stringify(item)}
                sx={{ alignItems: "flex-start", display: "block", py: 1.5 }}
              >
                <Typography component="h4" variant="subtitle1">
                  {item.title}
                </Typography>
                <Typography
                  color="text.secondary"
                  sx={{ mt: 0.5, overflowWrap: "anywhere" }}
                  variant="body2"
                >
                  {item.description}
                </Typography>
                {sources.length > 0 && (
                  <Stack
                    direction="row"
                    spacing={1}
                    useFlexGap
                    sx={{ flexWrap: "wrap", mt: 1 }}
                  >
                    <Typography color="text.secondary" variant="caption">
                      Sources
                    </Typography>
                    {sources.map((source) => (
                      <Link
                        aria-label={`Open source: ${source}`}
                        href={source}
                        key={source}
                        rel="noreferrer noopener"
                        target="_blank"
                        variant="caption"
                      >
                        {sourceLabel(source)}
                      </Link>
                    ))}
                  </Stack>
                )}
              </ListItem>
            )
          })}
        </List>
      )}
    </Paper>
  )
}

export function ResearchAnalysis({
  analysis,
}: {
  analysis: ResearchAnalysisResult
}) {
  const categories: AnalysisCategory[] = [
    {
      id: "research-facts",
      title: "Facts",
      description: "Material claims supported by the collected evidence.",
      emptyMessage: "No supported facts were identified.",
      items: analysis.facts,
    },
    {
      id: "research-disagreements",
      title: "Disagreements",
      description: "Material conflicts between sources or interpretations.",
      emptyMessage: "No material disagreements were identified.",
      items: analysis.disagreements,
    },
    {
      id: "research-gaps",
      title: "Gaps",
      description: "Important questions or evidence the research did not resolve.",
      emptyMessage: "No material evidence gaps were identified.",
      items: analysis.gaps,
    },
    {
      id: "research-assumptions",
      title: "Assumptions",
      description: "Material premises the answer relies on without proving.",
      emptyMessage: "No material assumptions were identified.",
      items: analysis.assumptions,
    },
  ]

  return (
    <Stack
      aria-labelledby="research-analysis-heading"
      component="section"
      spacing={1.5}
    >
      <Stack spacing={0.5}>
        <Typography component="h2" id="research-analysis-heading" variant="h5">
          Research analysis
        </Typography>
        <Typography color="text.secondary" variant="body2">
          A separate synthesis of what the research establishes, disputes,
          leaves open, and assumes.
        </Typography>
      </Stack>
      <Box
        sx={{
          display: "grid",
          gap: 2,
          gridTemplateColumns: { xs: "minmax(0, 1fr)", lg: "repeat(2, minmax(0, 1fr))" },
        }}
      >
        {categories.map((category) => (
          <AnalysisCategory category={category} key={category.id} />
        ))}
      </Box>
    </Stack>
  )
}
