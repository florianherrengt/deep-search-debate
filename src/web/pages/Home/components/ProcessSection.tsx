import EmojiEventsRounded from "@mui/icons-material/EmojiEventsRounded"
import GavelRounded from "@mui/icons-material/GavelRounded"
import LightbulbOutlined from "@mui/icons-material/LightbulbOutlined"
import Box from "@mui/material/Box"
import Paper from "@mui/material/Paper"
import Stack from "@mui/material/Stack"
import Typography from "@mui/material/Typography"
import { SectionHeading } from "./SectionHeading.tsx"

const processSteps = [
  {
    description:
      "Agents research your problem and build multiple distinct ideas.",
    icon: <LightbulbOutlined />,
    title: "Generate",
  },
  {
    description:
      "Agents defend one idea and challenge another in each head-to-head match.",
    icon: <GavelRounded />,
    title: "Debate",
  },
  {
    description:
      "Match winners keep advancing through the rounds until a winner emerges.",
    icon: <EmojiEventsRounded />,
    title: "Advance",
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
          const { palette } = theme.vars
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
            subtitle="Follow the agents through every matchup and see why each winner advances."
            title="How the tournament finds a winner"
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
