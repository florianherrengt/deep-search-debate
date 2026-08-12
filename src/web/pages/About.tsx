import AutoAwesomeRounded from "@mui/icons-material/AutoAwesomeRounded"
import LightbulbOutlined from "@mui/icons-material/LightbulbOutlined"
import SearchRounded from "@mui/icons-material/SearchRounded"
import { Box, Button, Paper, Stack, Typography } from "@mui/material"
import { Link } from "react-router-dom"
import { useSeo } from "../lib/seo.ts"

const steps = [
  {
    description:
      "Deep Search collects source results, explores the strongest candidates, and writes a final answer.",
    icon: <SearchRounded color="primary" />,
    title: "1. Research",
  },
  {
    description:
      "The idea workflow uses that research to build multiple distinct, practical ideas.",
    icon: <LightbulbOutlined color="primary" />,
    title: "2. Generate",
  },
  {
    description:
      "AI agents defend and challenge the ideas over multiple rounds, then show which one wins.",
    icon: <AutoAwesomeRounded color="primary" />,
    title: "3. Debate",
  },
]

export function About() {
  useSeo({
    title: "About — RethinkLoop",
    description:
      "RethinkLoop is a research and decision workspace: deep search, generated options, and AI agent debates over multiple rounds.",
    noindex: true,
  })

  return (
    <Stack spacing={{ xs: 4, sm: 5 }}>
      <Stack spacing={1.5} sx={{ maxWidth: "72ch" }}>
        <Typography component="h1" variant="h3">
          About RethinkLoop
        </Typography>
        <Typography color="text.secondary" component="p" variant="h6">
          A research and decision workspace for questions that need more than
          one model response.
        </Typography>
        <Typography>
          The application keeps the research, generated options, head-to-head
          arguments, judge decisions, and final outcome inspectable as one
          persisted workflow. You can reopen completed or failed work at any
          time.
        </Typography>
      </Stack>

      <Box component="section" aria-labelledby="how-it-works">
        <Typography
          component="h2"
          id="how-it-works"
          sx={{ mb: 2 }}
          variant="h5"
        >
          How it works
        </Typography>
        <Box
          sx={{
            display: "grid",
            gap: 2,
            gridTemplateColumns: { xs: "1fr", md: "repeat(3, 1fr)" },
          }}
        >
          {steps.map((step) => (
            <Paper key={step.title} sx={{ p: 2.5 }} variant="outlined">
              <Stack spacing={1.5}>
                {step.icon}
                <Typography component="h3" variant="h6">
                  {step.title}
                </Typography>
                <Typography color="text.secondary" variant="body2">
                  {step.description}
                </Typography>
              </Stack>
            </Paper>
          ))}
        </Box>
      </Box>

      <Stack spacing={1.5} sx={{ maxWidth: "72ch" }}>
        <Typography component="h2" variant="h5">
          Start where you need to
        </Typography>
        <Typography color="text.secondary">
          Use Deep Search for a direct researched answer, Ideas for concept
          generation, or Debates when the goal is to compare options and choose
          one.
        </Typography>
        <Stack direction={{ xs: "column", sm: "row" }} spacing={1.5}>
          <Button component={Link} to="/deep-search" variant="outlined">
            Start with research
          </Button>
          <Button component={Link} to="/debates" variant="contained">
            Start a debate
          </Button>
        </Stack>
      </Stack>
    </Stack>
  )
}
