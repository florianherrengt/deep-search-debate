import {
  CheckCircleOutlined,
  EmojiEventsRounded,
  RemoveCircleOutlined,
} from "@mui/icons-material"
import { Box, Card, CardContent, Chip, Stack, Typography } from "@mui/material"
import { useId } from "react"
import { ExternalLink } from "../../../components/ExternalLink.tsx"
import type { IdeaEvaluation } from "../../../lib/ideaJobs.ts"
import { AssessmentPoints } from "../../Ideas/components/IdeaAssessment.tsx"
import type { DebateIdea } from "../debateUiTypes.ts"

export function WinnerIdeaCard({
  closestAlternative,
  evaluation,
  idea,
  ideaJobId,
  ideaJobSlug,
  reason,
  websiteIdeaId,
}: {
  closestAlternative?: DebateIdea
  evaluation?: IdeaEvaluation
  idea: DebateIdea
  ideaJobId: string
  ideaJobSlug: string
  reason?: string
  websiteIdeaId?: string
}) {
  const explanationId = useId()
  const showExplanation = Boolean(reason || closestAlternative)
  const websiteUrl =
    websiteIdeaId === undefined
      ? undefined
      : `/api/idea-jobs/${encodeURIComponent(ideaJobId)}/ideas/${encodeURIComponent(websiteIdeaId)}/website`
  const ideaDetailsUrl = `/ideas/${encodeURIComponent(ideaJobSlug)}/${encodeURIComponent(idea.ideaId)}#improved-idea`

  return (
    <Card variant="outlined" sx={{ borderColor: "success.main" }}>
      <CardContent>
        <Stack
          direction={{ xs: "column", sm: "row" }}
          spacing={2}
          sx={{ alignItems: { sm: "flex-start" } }}
        >
          <EmojiEventsRounded color="success" sx={{ fontSize: 34 }} />
          <Stack spacing={1} sx={{ flexGrow: 1 }}>
            <Chip
              color="success"
              label="Winning idea"
              size="small"
              sx={{ alignSelf: "flex-start" }}
              variant="outlined"
            />
            <Typography component="h2" variant="h5">
              <ExternalLink color="inherit" to={ideaDetailsUrl}>
                {idea.title}
              </ExternalLink>
            </Typography>
            <Typography color="text.secondary" variant="body2">
              {idea.description}
            </Typography>
            {websiteUrl && (
              <MuiLink
                href={websiteUrl}
                rel="noopener noreferrer"
                sx={{ alignSelf: "flex-start" }}
                target="_blank"
                variant="body2"
              >
                Open the generated website
              </MuiLink>
            )}
            {evaluation && (
              <Stack
                aria-labelledby={`${explanationId}-pros-cons`}
                component="section"
                spacing={1.5}
                sx={{ pt: 0.5 }}
              >
                <Typography
                  component="h3"
                  id={`${explanationId}-pros-cons`}
                  variant="subtitle1"
                >
                  Pros and cons
                </Typography>
                <Box
                  sx={{
                    display: "grid",
                    gap: 2,
                    gridTemplateColumns: {
                      xs: "1fr",
                      md: "repeat(2, minmax(0, 1fr))",
                    },
                  }}
                >
                  <AssessmentPoints
                    color="success.main"
                    headingComponent="h4"
                    icon={CheckCircleOutlined}
                    points={evaluation.pros}
                    title="Pros"
                  />
                  <AssessmentPoints
                    color="warning.main"
                    headingComponent="h4"
                    icon={RemoveCircleOutlined}
                    points={evaluation.cons}
                    title="Cons"
                  />
                </Box>
              </Stack>
            )}
            {showExplanation && (
              <Stack
                aria-labelledby={`${explanationId}-heading`}
                component="section"
                spacing={1.5}
                sx={{ pt: 0.5 }}
              >
                <Typography
                  component="h3"
                  id={`${explanationId}-heading`}
                  variant="subtitle1"
                >
                  Why it won
                </Typography>
                {reason && (
                  <Stack spacing={0.5}>
                    <Typography component="h4" variant="subtitle2">
                      Decisive strengths
                    </Typography>
                    <Typography color="text.secondary" variant="body2">
                      {reason}
                    </Typography>
                  </Stack>
                )}
                {closestAlternative && (
                  <Stack
                    aria-labelledby={`${explanationId}-alternative`}
                    component="section"
                    spacing={0.5}
                  >
                    <Typography
                      component="h4"
                      id={`${explanationId}-alternative`}
                      variant="subtitle2"
                    >
                      Closest alternative
                    </Typography>
                    <Typography sx={{ fontWeight: 600 }} variant="body2">
                      <ExternalLink
                        color="inherit"
                        sx={{ fontWeight: 600 }}
                        to={`/ideas/${encodeURIComponent(ideaJobSlug)}/${encodeURIComponent(closestAlternative.ideaId)}#improved-idea`}
                      >
                        {closestAlternative.title}
                      </ExternalLink>
                    </Typography>
                    <Typography color="text.secondary" variant="body2">
                      {closestAlternative.description}
                    </Typography>
                  </Stack>
                )}
              </Stack>
            )}
          </Stack>
        </Stack>
      </CardContent>
    </Card>
  )
}
