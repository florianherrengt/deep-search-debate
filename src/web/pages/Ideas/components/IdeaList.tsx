import ArrowForward from "@mui/icons-material/ArrowForward"
import Card from "@mui/material/Card"
import CardActionArea from "@mui/material/CardActionArea"
import CardContent from "@mui/material/CardContent"
import Chip from "@mui/material/Chip"
import Stack from "@mui/material/Stack"
import Typography from "@mui/material/Typography"
import { Link } from "react-router-dom"
import {
  getIdeaPresentation,
  type IdeaJobRunState,
} from "../ideaJobState.ts"

export function IdeaList({
  run,
  jobSlug,
  ideas = run.ideas,
  headingComponent = "h3",
  showDescriptions = false,
}: {
  jobSlug: string
  run: IdeaJobRunState
  ideas?: IdeaJobRunState["ideas"]
  headingComponent?: "h3" | "h4"
  showDescriptions?: boolean
}) {
  return (
    <Stack component="ul" spacing={1} sx={{ listStyle: "none", m: 0, p: 0 }}>
      {ideas.map((idea) => {
        const presentation = getIdeaPresentation(idea, run)
        const displayedIdea = presentation.displayIdea
        const destination = `/ideas/${encodeURIComponent(jobSlug)}/${encodeURIComponent(idea.ideaId)}`

        return (
          <Card component="li" key={idea.ideaId} variant="outlined">
            <CardActionArea
              aria-label={`View ${displayedIdea.title}`}
              component={Link}
              to={`${destination}${presentation.linkHash}`}
            >
              <CardContent>
                <Stack
                  direction={{ xs: "column", sm: "row" }}
                  spacing={2}
                  sx={{
                    alignItems: { xs: "flex-start", sm: "center" },
                    justifyContent: "space-between",
                  }}
                >
                  <Stack spacing={0.5} sx={{ minWidth: 0 }}>
                    <Typography component={headingComponent} variant="subtitle1">
                      {displayedIdea.title}
                    </Typography>
                    {showDescriptions && (
                      <Typography color="text.secondary" variant="body2">
                        {displayedIdea.description}
                      </Typography>
                    )}
                  </Stack>
                  <Stack
                    direction="row"
                    spacing={1}
                    sx={{
                      alignItems: "center",
                      alignSelf: { xs: "stretch", sm: "center" },
                      flexShrink: 0,
                      justifyContent: "space-between",
                    }}
                  >
                    <Chip
                      color={presentation.color}
                      label={presentation.label}
                      size="small"
                      variant="outlined"
                    />
                    <ArrowForward aria-hidden="true" color="action" />
                  </Stack>
                </Stack>
              </CardContent>
            </CardActionArea>
          </Card>
        )
      })}
    </Stack>
  )
}
