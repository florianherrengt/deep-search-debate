import { Link, Paper, Typography } from "@mui/material"
import { alpha, type Theme } from "@mui/material/styles"
import type { DeepSearchResultState } from "../deepSearchState.ts"
import { PageSummary } from "./PageSummary.tsx"

type SearchResultCardProps = {
  result: DeepSearchResultState
}

function getBorderColor(
  theme: Theme,
  selection: DeepSearchResultState["selection"],
): string {
  if (selection === "pending") return theme.palette.divider
  if (selection === "selected") {
    return alpha(theme.palette.success.main, 0.55)
  }
  return alpha(theme.palette.error.main, 0.55)
}

export function SearchResultCard({ result }: SearchResultCardProps) {
  const isSelected = result.selection === "selected"

  return (
    <Paper
      variant="outlined"
      data-selected={isSelected ? "true" : undefined}
      data-selection-status={result.selection}
      sx={(theme) => ({
        p: 2,
        borderColor: getBorderColor(theme, result.selection),
      })}
    >
      <Link href={result.link} target="_blank" rel="noreferrer">
        {result.title}
      </Link>
      <Typography variant="body2" sx={{ mt: 1 }}>
        {result.shortText}
      </Typography>
      <Typography
        variant="caption"
        color="text.secondary"
        sx={{ overflowWrap: "anywhere" }}
      >
        {result.link}
      </Typography>
      {isSelected && result.summary && <PageSummary summary={result.summary} />}
    </Paper>
  )
}
