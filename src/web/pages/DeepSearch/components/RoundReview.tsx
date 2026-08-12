import { Alert, Stack } from "@mui/material"
import { GenerationOutput } from "../../../components/streaming/GenerationOutput.tsx"
import type { DeepSearchRoundReviewState } from "../../../lib/deepSearchState.ts"

type RoundReviewProps = {
  review: DeepSearchRoundReviewState
}

function getOutcomeCopy(review: DeepSearchRoundReviewState): string {
  switch (review.status) {
    case "continue":
      return "More research requested. "
    case "stop":
      return "Research is sufficient. "
    case "error":
      return "Review failed; using the current answer. "
    case "running":
      return ""
  }
}

/** Displays one optional candidate-answer review and its durable outcome. */
export function RoundReview({ review }: RoundReviewProps) {
  const title = `Round ${review.round + 1} research review`

  return (
    <Stack spacing={1}>
      {review.streamId && (
        <GenerationOutput
          announcementLabel={title}
          headingComponent="h4"
          showText={false}
          streamId={review.streamId}
          title={title}
          waitingText="Reviewing the available evidence…"
          testId={`round-review-${review.round}`}
        />
      )}
      {review.status !== "running" && (
        <Alert severity={review.status === "error" ? "warning" : "info"}>
          {getOutcomeCopy(review)}
          {review.reason}
        </Alert>
      )}
    </Stack>
  )
}
