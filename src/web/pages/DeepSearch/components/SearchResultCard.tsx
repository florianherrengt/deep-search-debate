import { Chip, Paper, Stack, Typography } from "@mui/material"
import { alpha, type Theme } from "@mui/material/styles"
import { ExternalLink } from "../../../components/ExternalLink.tsx"
import type { DeepSearchResultState } from "../../../lib/deepSearchState.ts"
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
    return alpha(theme.palette.primary.main, 0.55)
  }
  return theme.palette.divider
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
        backgroundColor: isSelected
          ? alpha(theme.palette.primary.main, 0.035)
          : undefined,
      })}
    >
      <Stack
        direction={{ xs: "column", sm: "row" }}
        spacing={1}
        sx={{ justifyContent: "space-between", alignItems: { sm: "flex-start" } }}
      >
        <Typography component="div" variant="subtitle1">
          <ExternalLink href={result.link}>{result.title}</ExternalLink>
        </Typography>
        <Chip
          size="small"
          color={isSelected ? "primary" : "default"}
          variant="outlined"
          label={isSelected ? "Explored source" : "Search listing"}
        />
      </Stack>
      <Typography variant="overline" color="text.secondary" sx={{ mt: 1, display: "block" }}>
        Search description
      </Typography>
      <Typography variant="body2">
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
