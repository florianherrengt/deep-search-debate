import EmojiEventsRounded from "@mui/icons-material/EmojiEventsRounded"
import GavelRounded from "@mui/icons-material/GavelRounded"
import SearchRounded from "@mui/icons-material/SearchRounded"
import Box from "@mui/material/Box"
import Paper from "@mui/material/Paper"
import Stack from "@mui/material/Stack"
import Typography from "@mui/material/Typography"
import { SectionHeading } from "./SectionHeading.tsx"

const processSteps = [
  {
    description:
      "Agents research your problem and turn what they find into distinct ideas.",
    icon: <SearchRounded />,
    title: "Research",
  },
  {
    description:
      "Agents defend and challenge the ideas head-to-head over multiple rounds.",
    icon: <GavelRounded />,
    title: "Debate",
  },
  {
    description:
      "The final result shows which idea won and why.",
    icon: <EmojiEventsRounded />,
    title: "Answer",
  },
] as const

export function ProcessSection() {
  return (
    <Box
      component="section"
      aria-labelledby="process-heading"
      id="how-it-works"
      sx={{ scrollMarginTop: 32 }}
    >
      <Paper
        sx={(theme) => {
          const palette = (theme.vars ?? theme).palette
          return {
            background: `linear-gradient(135deg, ${palette.background.paper}, color-mix(in srgb, ${palette.secondary.main} 7%, ${palette.background.paper}))`,
            borderRadius: { xs: 2, md: 3 },
            p: { xs: 3, sm: 5, md: 6 },
          }
        }}
        variant="outlined"
      >
        <Stack spacing={{ xs: 5, md: 6 }}>
          <SectionHeading
            eyebrow="How it works"
            id="process-heading"
            subtitle="The work stays clear from the first source to the final result."
            title="How agents test the ideas"
          />
          <Box
            sx={{
              display: "grid",
              gap: 2,
              gridTemplateColumns: { xs: "1fr", md: "repeat(3, 1fr)" },
            }}
          >
            {processSteps.map((step, index) => (
              <Paper
                key={step.title}
                sx={{ bgcolor: "background.default", height: "100%", p: 2.5 }}
                variant="outlined"
              >
                <Stack spacing={2.5} sx={{ height: "100%" }}>
                  <Stack
                    direction="row"
                    sx={{ alignItems: "center", justifyContent: "space-between" }}
                  >
                    <Box sx={{ color: "primary.main", display: "flex" }}>
                      {step.icon}
                    </Box>
                    <Typography color="text.disabled" variant="caption">
                      {String(index + 1).padStart(2, "0")}
                    </Typography>
                  </Stack>
                  <Typography component="h3" variant="h4">
                    {step.title}
                  </Typography>
                  <Typography color="text.secondary">
                    {step.description}
                  </Typography>
                </Stack>
              </Paper>
            ))}
          </Box>
        </Stack>
      </Paper>
    </Box>
  )
}
