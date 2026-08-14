import CheckCircleOutlined from "@mui/icons-material/CheckCircleOutlined"
import RemoveCircleOutlined from "@mui/icons-material/RemoveCircleOutlined"
import Box from "@mui/material/Box"
import Card from "@mui/material/Card"
import CardContent from "@mui/material/CardContent"
import Divider from "@mui/material/Divider"
import Stack from "@mui/material/Stack"
import Typography from "@mui/material/Typography"
import type { IdeaEvaluation } from "../../../lib/ideaJobs.ts"

function AssessmentPoints({
  color,
  headingComponent,
  icon: Icon,
  points,
  title,
}: {
  color: "success.main" | "warning.main"
  headingComponent: "h3" | "h4"
  icon: typeof CheckCircleOutlined
  points: string[]
  title: string
}) {
  return (
    <Stack spacing={1.25}>
      <Typography component={headingComponent} variant="subtitle1">
        {title}
      </Typography>
      <Stack
        component="ul"
        spacing={1.25}
        sx={{ listStyle: "none", m: 0, p: 0 }}
      >
        {points.map((point) => (
          <Stack
            component="li"
            direction="row"
            key={point}
            spacing={1}
            sx={{ alignItems: "flex-start" }}
          >
            <Icon sx={{ color, flexShrink: 0, mt: 0.25 }} />
            <Typography variant="body2">{point}</Typography>
          </Stack>
        ))}
      </Stack>
    </Stack>
  )
}

export function IdeaAssessment({
  evaluation,
  headingComponent = "h2",
  position,
}: {
  evaluation: IdeaEvaluation
  headingComponent?: "h2" | "h3"
  position: number
}) {
  const detailHeadingComponent = headingComponent === "h2" ? "h3" : "h4"

  return (
    <Card
      component="section"
      data-testid={`idea-assessment-${position}`}
      variant="outlined"
    >
      <CardContent>
        <Stack spacing={2}>
          <Stack spacing={0.5}>
            <Typography component={headingComponent} variant="h6">
              Assessment of original idea
            </Typography>
            <Typography color="text.secondary" variant="body2">
              Based on the shared research briefing used to evaluate every idea.
            </Typography>
          </Stack>
          <Box
            sx={{
              display: "grid",
              gap: 3,
              gridTemplateColumns: {
                xs: "1fr",
                md: "repeat(2, minmax(0, 1fr))",
              },
            }}
          >
            <AssessmentPoints
              color="success.main"
              headingComponent={detailHeadingComponent}
              icon={CheckCircleOutlined}
              points={evaluation.pros}
              title="Pros"
            />
            <AssessmentPoints
              color="warning.main"
              headingComponent={detailHeadingComponent}
              icon={RemoveCircleOutlined}
              points={evaluation.cons}
              title="Cons"
            />
          </Box>
          <Divider />
          <Stack spacing={0.75}>
            <Typography component={detailHeadingComponent} variant="subtitle1">
              Analysis
            </Typography>
            <Typography color="text.secondary">
              {evaluation.critique}
            </Typography>
          </Stack>
        </Stack>
      </CardContent>
    </Card>
  )
}
