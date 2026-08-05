import {
  AutoAwesomeRounded,
  LightbulbOutlined,
  SearchRounded,
} from "@mui/icons-material"
import {
  Box,
  Button,
  Card,
  CardActionArea,
  CardContent,
  Stack,
  Typography,
} from "@mui/material"
import type { ReactNode } from "react"
import { Link } from "react-router-dom"

const workflows: Array<{
  action: string
  description: string
  icon: ReactNode
  title: string
  to: string
}> = [
  {
    action: "Research a question",
    description:
      "Search the web, inspect the source-level findings, and produce a source-backed final answer.",
    icon: <SearchRounded color="primary" />,
    title: "Deep Search",
    to: "/deep-search",
  },
  {
    action: "Generate ideas",
    description:
      "Turn a researched problem into twelve concrete concepts with the evidence kept alongside them.",
    icon: <LightbulbOutlined color="primary" />,
    title: "Ideas",
    to: "/ideas",
  },
  {
    action: "Compare ideas",
    description:
      "Run all twelve concepts through a 33-match tournament and inspect the winning argument.",
    icon: <AutoAwesomeRounded color="primary" />,
    title: "Debates",
    to: "/debates",
  },
]

export function Home() {
  return (
    <Stack spacing={{ xs: 4, sm: 5 }}>
      <Stack spacing={2} sx={{ maxWidth: "68ch" }}>
        <Typography color="primary" variant="overline">
          Agent-assisted research
        </Typography>
        <Typography component="h1" variant="h3">
          Research, generate, and decide
        </Typography>
        <Typography color="text.secondary" component="p" variant="h6">
          Move from an open question to grounded ideas, structured debate, and
          a final winner without losing the research behind the decision.
        </Typography>
        <Stack direction={{ xs: "column", sm: "row" }} spacing={1.5}>
          <Button
            component={Link}
            startIcon={<AutoAwesomeRounded />}
            to="/debates"
            variant="contained"
          >
            Start a tournament
          </Button>
          <Button component={Link} to="/deep-search" variant="outlined">
            Start with research
          </Button>
        </Stack>
      </Stack>

      <Box component="section" aria-labelledby="workflow-heading">
        <Typography
          component="h2"
          id="workflow-heading"
          sx={{ mb: 2 }}
          variant="h5"
        >
          Choose a workflow
        </Typography>
        <Box
          sx={{
            display: "grid",
            gap: 2,
            gridTemplateColumns: { xs: "1fr", md: "repeat(3, 1fr)" },
          }}
        >
          {workflows.map((workflow) => (
            <Card key={workflow.to} variant="outlined">
              <CardActionArea
                component={Link}
                sx={{ height: "100%" }}
                to={workflow.to}
              >
                <CardContent sx={{ height: "100%" }}>
                  <Stack spacing={1.5} sx={{ height: "100%" }}>
                    {workflow.icon}
                    <Typography component="h3" variant="h6">
                      {workflow.title}
                    </Typography>
                    <Typography
                      color="text.secondary"
                      sx={{ flexGrow: 1 }}
                      variant="body2"
                    >
                      {workflow.description}
                    </Typography>
                    <Typography color="primary" variant="button">
                      {workflow.action}
                    </Typography>
                  </Stack>
                </CardContent>
              </CardActionArea>
            </Card>
          ))}
        </Box>
      </Box>
    </Stack>
  )
}
