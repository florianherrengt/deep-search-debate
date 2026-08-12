import ExpandMore from "@mui/icons-material/ExpandMore"
import {
  Accordion,
  AccordionDetails,
  AccordionSummary,
  Chip,
  Stack,
  Typography,
} from "@mui/material"
import { useState } from "react"
import { GenerationOutput } from "../../../components/streaming/GenerationOutput.tsx"
import type {
  DeepSearchRoundReviewState,
  DeepSearchSearchState,
} from "../../../lib/deepSearchState.ts"
import { RoundReview } from "./RoundReview.tsx"
import { SearchResults } from "./SearchResults.tsx"

type ResearchRoundProps = {
  answerStreamId?: string
  finished: boolean
  queryStreamId?: string
  review?: DeepSearchRoundReviewState
  round: number
  searches: DeepSearchSearchState[]
}

function getRoundAnswer(
  answerStreamId: string | undefined,
  finished: boolean,
  review?: DeepSearchRoundReviewState,
): string {
  if (review?.reason) return review.reason
  if (review?.status === "running") {
    return "Reviewing whether more research is needed…"
  }
  if (finished) return "Round complete. Its candidate answer is ready."
  if (answerStreamId) return "Writing the candidate answer…"
  return "Research and source analysis are in progress…"
}

/** Groups one research round into an independently expandable card. */
export function ResearchRound({
  answerStreamId,
  finished,
  queryStreamId,
  review,
  round,
  searches,
}: ResearchRoundProps) {
  const [expandedOverride, setExpandedOverride] = useState<boolean>()
  const expanded = expandedOverride ?? !finished
  const title = `Round ${round + 1}`

  return (
    <Accordion
      disableGutters
      elevation={0}
      expanded={expanded}
      onChange={(_event, nextExpanded) => setExpandedOverride(nextExpanded)}
      slots={{ heading: "h3" }}
      slotProps={{ transition: { unmountOnExit: false } }}
      variant="outlined"
      sx={{
        borderRadius: 1,
        overflow: "hidden",
        "&::before": { display: "none" },
      }}
    >
      <AccordionSummary expandIcon={<ExpandMore />}>
        <Stack spacing={0.75} sx={{ minWidth: 0, width: "100%", pr: 1 }}>
          <Stack
            direction="row"
            spacing={1}
            sx={{ alignItems: "center", justifyContent: "space-between" }}
          >
            <Typography component="span" variant="h5">
              {title}
            </Typography>
            <Chip
              color={finished ? "default" : "primary"}
              label={finished ? "Complete" : "In progress"}
              size="small"
              variant="outlined"
            />
          </Stack>
          <Typography
            color="text.secondary"
            variant="body2"
            sx={{ maxWidth: "85ch", overflowWrap: "anywhere" }}
          >
            {getRoundAnswer(answerStreamId, finished, review)}
          </Typography>
        </Stack>
      </AccordionSummary>
      <AccordionDetails sx={{ pt: 0, px: { xs: 2, sm: 3 }, pb: 3 }}>
        <Stack spacing={2}>
          {queryStreamId && (
            <GenerationOutput
              format="structured-list"
              headingComponent="h4"
              streamId={queryStreamId}
              title={`${title} search queries`}
              waitingText="Generating search queries…"
              testId={`generated-search-queries-${round}`}
            />
          )}
          <SearchResults searches={searches} />
          {answerStreamId && (
            <GenerationOutput
              format="markdown"
              headingComponent="h4"
              streamId={answerStreamId}
              title={`${title} candidate answer`}
              waitingText="Writing the current answer…"
              testId={`round-answer-${round}`}
            />
          )}
          {review && <RoundReview review={review} />}
        </Stack>
      </AccordionDetails>
    </Accordion>
  )
}
