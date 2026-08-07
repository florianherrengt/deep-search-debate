import EmojiEventsRounded from "@mui/icons-material/EmojiEventsRounded"
import FactCheckOutlined from "@mui/icons-material/FactCheckOutlined"
import GavelRounded from "@mui/icons-material/GavelRounded"
import LightbulbOutlined from "@mui/icons-material/LightbulbOutlined"
import Box from "@mui/material/Box"
import Paper from "@mui/material/Paper"
import Stack from "@mui/material/Stack"
import Typography from "@mui/material/Typography"
import { SectionHeading } from "./SectionHeading.tsx"

const benefits = [
  {
    description:
      "The agents build multiple researched approaches instead of stopping at the first answer.",
    icon: <LightbulbOutlined />,
    title: "Different ideas",
  },
  {
    description:
      "Each matchup gives competing ideas a serious defence and challenge.",
    icon: <FactCheckOutlined />,
    title: "Both sides argued",
  },
  {
    description:
      "Bad assumptions, weak claims, and missing facts are harder to hide.",
    icon: <GavelRounded />,
    title: "Weak points exposed",
  },
  {
    description:
      "See every result, the full debates, and why the winning idea won.",
    icon: <EmojiEventsRounded />,
    title: "A visible decision",
  },
] as const

export function BenefitsSection() {
  return (
    <Box component="section" aria-labelledby="benefits-heading">
      <Stack spacing={{ xs: 4, md: 5 }}>
        <SectionHeading
          eyebrow="What you get"
          id="benefits-heading"
          subtitle="The result includes every match, not just the winner."
          title="See how one idea beat the rest"
        />
        <Box
          sx={{
            display: "grid",
            gap: 2,
            gridTemplateColumns: { xs: "1fr", sm: "repeat(2, 1fr)" },
          }}
        >
          {benefits.map((benefit, index) => (
            <Paper
              key={benefit.title}
              sx={(theme) => {
                const { palette } = theme.vars
                return {
                  background:
                    index === 0
                      ? `linear-gradient(145deg, color-mix(in srgb, ${palette.primary.main} 13%, ${palette.background.paper}), ${palette.background.paper})`
                      : palette.background.paper,
                  borderRadius: 2,
                  p: { xs: 2.5, md: 3 },
                }
              }}
              variant="outlined"
            >
              <Stack direction="row" spacing={2} sx={{ alignItems: "flex-start" }}>
                <Box
                  sx={{
                    alignItems: "center",
                    bgcolor: "action.selected",
                    borderRadius: 1.5,
                    color: "primary.main",
                    display: "flex",
                    flexShrink: 0,
                    height: 44,
                    justifyContent: "center",
                    width: 44,
                  }}
                >
                  {benefit.icon}
                </Box>
                <Stack spacing={0.75}>
                  <Typography component="h3" variant="h5">
                    {benefit.title}
                  </Typography>
                  <Typography color="text.secondary">
                    {benefit.description}
                  </Typography>
                </Stack>
              </Stack>
            </Paper>
          ))}
        </Box>
      </Stack>
    </Box>
  )
}
