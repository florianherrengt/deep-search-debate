import ArrowDownwardRounded from "@mui/icons-material/ArrowDownwardRounded"
import CircleRounded from "@mui/icons-material/CircleRounded"
import EmojiEventsRounded from "@mui/icons-material/EmojiEventsRounded"
import FactCheckOutlined from "@mui/icons-material/FactCheckOutlined"
import GavelRounded from "@mui/icons-material/GavelRounded"
import Box from "@mui/material/Box"
import Paper from "@mui/material/Paper"
import Stack from "@mui/material/Stack"
import Typography from "@mui/material/Typography"

const ideaLabels = ["A", "B", "C", "…"] as const

const debateInputs = [
  {
    description: "Facts checked first",
    icon: <FactCheckOutlined color="primary" fontSize="small" />,
    label: "Research",
  },
  {
    description: "Debate each matchup",
    icon: <GavelRounded color="secondary" fontSize="small" />,
    label: "AI agents",
  },
] as const

const winnerDetails = ["Match record", "Strongest case", "Full debates"] as const

export function IdeaTournamentDiagram() {
  return (
    <Paper
      aria-label="Multiple researched ideas are debated by AI agents through multiple rounds until a winner emerges."
      role="img"
      sx={(theme) => {
        const palette = (theme.vars ?? theme).palette
        return {
          background: `linear-gradient(145deg, color-mix(in srgb, ${palette.primary.main} 10%, ${palette.background.paper}), ${palette.background.paper} 48%, color-mix(in srgb, ${palette.secondary.main} 8%, ${palette.background.paper}))`,
          borderRadius: 1,
          boxShadow: `0 32px 90px color-mix(in srgb, ${palette.common.black} 45%, transparent)`,
          overflow: "hidden",
          p: { xs: 2, sm: 3 },
          position: "relative",
          "&::before": {
            backgroundImage: `linear-gradient(color-mix(in srgb, ${palette.divider} 55%, transparent) 1px, transparent 1px), linear-gradient(90deg, color-mix(in srgb, ${palette.divider} 55%, transparent) 1px, transparent 1px)`,
            backgroundSize: "32px 32px",
            content: '""',
            inset: 0,
            maskImage: "linear-gradient(to bottom, black, transparent 78%)",
            opacity: 0.5,
            pointerEvents: "none",
            position: "absolute",
          },
        }
      }}
      variant="outlined"
    >
      <Stack aria-hidden="true" spacing={2} sx={{ position: "relative" }}>
        <Stack
          direction="row"
          spacing={1}
          sx={{ alignItems: "center", justifyContent: "space-between" }}
        >
          <Stack direction="row" spacing={1} sx={{ alignItems: "center" }}>
            <CircleRounded sx={{ color: "primary.main", fontSize: 8 }} />
            <Typography color="text.secondary" variant="overline">
              Debate flow
            </Typography>
          </Stack>
          <Typography color="text.disabled" variant="caption">
            Ideas → Rounds → Winner
          </Typography>
        </Stack>

        <Paper
          sx={{
            bgcolor: "background.default",
            borderRadius: 1,
            p: 2,
          }}
          variant="outlined"
        >
          <Stack spacing={1.5}>
            <Typography color="text.secondary" variant="overline">
              Multiple ideas enter
            </Typography>
            <Box
              sx={{
                display: "grid",
                gap: 0.75,
                gridTemplateColumns: "repeat(4, minmax(0, 1fr))",
              }}
            >
              {ideaLabels.map((label, index) => (
                <Box
                  key={label}
                  sx={{
                    alignItems: "center",
                    bgcolor: index < 2 ? "action.selected" : "action.hover",
                    border: 1,
                    borderColor: "divider",
                    borderRadius: 1,
                    display: "flex",
                    height: 28,
                    justifyContent: "center",
                  }}
                >
                  <Typography color="text.secondary" variant="caption">
                    {label}
                  </Typography>
                </Box>
              ))}
            </Box>
          </Stack>
        </Paper>

        <Box
          sx={{
            display: "grid",
            gap: 1.5,
            gridTemplateColumns: "repeat(2, minmax(0, 1fr))",
          }}
        >
          {debateInputs.map((input) => (
            <Paper
              key={input.label}
              sx={{ bgcolor: "background.default", p: 1.75 }}
              variant="outlined"
            >
              <Stack
                direction="row"
                spacing={1.25}
                sx={{ alignItems: "center" }}
              >
                {input.icon}
                <Box>
                  <Typography color="text.secondary" variant="overline">
                    {input.label}
                  </Typography>
                  <Typography variant="body2">{input.description}</Typography>
                </Box>
              </Stack>
            </Paper>
          ))}
        </Box>

        <ArrowDownwardRounded
          sx={{ alignSelf: "center", color: "text.disabled", my: -0.5 }}
        />

        <Paper
          sx={(theme) => {
            const palette = (theme.vars ?? theme).palette
            return {
              background: `linear-gradient(135deg, ${palette.primary.main}, color-mix(in srgb, ${palette.primary.main} 72%, ${palette.secondary.main}))`,
              border: 0,
              borderRadius: 1,
              color: "primary.contrastText",
              p: 2.25,
            }
          }}
        >
          <Stack spacing={1.75}>
            <Stack direction="row" spacing={1} sx={{ alignItems: "center" }}>
              <EmojiEventsRounded fontSize="small" />
              <Typography color="inherit" variant="overline">
                Winning idea
              </Typography>
            </Stack>
            <Typography color="inherit" variant="h5">
              Why this idea won
            </Typography>
            <Stack
              direction="row"
              spacing={1}
              useFlexGap
              sx={{ flexWrap: "wrap" }}
            >
              {winnerDetails.map((label) => (
                <Box
                  key={label}
                  sx={{
                    bgcolor: "color-mix(in srgb, currentColor 10%, transparent)",
                    border: "1px solid",
                    borderColor:
                      "color-mix(in srgb, currentColor 24%, transparent)",
                    borderRadius: 1,
                    px: 1.25,
                    py: 0.5,
                  }}
                >
                  <Typography color="inherit" variant="caption">
                    {label}
                  </Typography>
                </Box>
              ))}
            </Stack>
          </Stack>
        </Paper>
      </Stack>
    </Paper>
  )
}
