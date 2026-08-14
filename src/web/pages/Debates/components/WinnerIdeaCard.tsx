import { EmojiEventsRounded } from "@mui/icons-material"
import { Card, CardContent, Chip, Stack, Typography } from "@mui/material"
import { useId } from "react"
import type { DebateIdea } from "../debateUiTypes.ts"

export function WinnerIdeaCard({
  closestAlternative,
  idea,
  reason,
}: {
  closestAlternative?: DebateIdea
  idea: DebateIdea
  reason?: string
}) {
  const explanationId = useId()
  const showExplanation = Boolean(reason || closestAlternative)

  return (
    <Card
      variant="outlined"
      sx={{
        borderColor: "success.dark",
        borderLeftColor: "success.main",
        borderLeftWidth: 3,
      }}
    >
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
              {idea.title}
            </Typography>
            <Typography color="text.secondary" variant="body2">
              {idea.description}
            </Typography>
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
                      {closestAlternative.title}
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
