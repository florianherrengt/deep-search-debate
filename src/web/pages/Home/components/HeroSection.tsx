import ArrowForwardRounded from "@mui/icons-material/ArrowForwardRounded"
import BalanceRounded from "@mui/icons-material/BalanceRounded"
import Box from "@mui/material/Box"
import Button from "@mui/material/Button"
import Stack from "@mui/material/Stack"
import Typography from "@mui/material/Typography"
import { Link as RouterLink } from "react-router-dom"
import { IdeaTournamentDiagram } from "./IdeaTournamentDiagram.tsx"

export function HeroSection() {
  return (
    <Box
      component="section"
      sx={(theme) => {
        const { palette } = theme.vars
        return {
          alignItems: "center",
          display: "grid",
          gap: { xs: 6, md: 8 },
          gridTemplateColumns: {
            xs: "1fr",
            md: "minmax(0, 1.08fr) minmax(380px, 0.92fr)",
          },
          minHeight: { md: "calc(100dvh - 96px)" },
          overflow: "clip",
          pb: { xs: 8, md: 11 },
          position: "relative",
          pt: { xs: 7, md: 10 },
          "&::before": {
            background: `radial-gradient(circle, color-mix(in srgb, ${palette.primary.main} 14%, transparent) 0%, transparent 68%)`,
            content: '""',
            height: { xs: 420, md: 700 },
            pointerEvents: "none",
            position: "absolute",
            right: { xs: "-45%", md: "-22%" },
            top: { xs: "42%", md: "48%" },
            width: { xs: 560, md: 760 },
          },
        }
      }}
    >
      <Stack
        spacing={{ xs: 3, md: 3.5 }}
        sx={{ alignItems: "flex-start", isolation: "isolate" }}
      >
        <Stack
          direction="row"
          spacing={1}
          sx={{
            alignItems: "center",
            border: 1,
            borderColor: "divider",
            borderRadius: 999,
            color: "text.secondary",
            px: 1.5,
            py: 0.75,
          }}
        >
          <BalanceRounded color="primary" fontSize="small" />
          <Typography variant="caption">AI idea tournament</Typography>
        </Stack>

        <Typography
          component="h1"
          sx={{
            fontSize: "clamp(3.2rem, 7vw, 6rem)",
            fontWeight: 650,
            letterSpacing: "-0.05em",
            lineHeight: 0.96,
            maxWidth: "10ch",
          }}
          variant="h1"
        >
          One answer is not enough.
        </Typography>

        <Typography
          component="p"
          sx={{ fontWeight: 650, maxWidth: "24ch" }}
          variant="h4"
        >
          Watch AI agents debate ideas. See which one wins.
        </Typography>

        <Typography
          color="text.secondary"
          component="p"
          sx={{ fontSize: { xs: "1.05rem", sm: "1.2rem" }, maxWidth: "56ch" }}
        >
          Give them a problem. They generate distinct, researched ideas and
          test them head-to-head over multiple rounds.
        </Typography>

        <Stack direction={{ xs: "column", sm: "row" }} spacing={1.5}>
          <Button
            component={RouterLink}
            endIcon={<ArrowForwardRounded />}
            size="large"
            to="/debates"
            variant="contained"
          >
            Start a debate
          </Button>
          <Button
            component="a"
            href="#how-it-works"
            size="large"
            variant="outlined"
          >
            How it works
          </Button>
        </Stack>
      </Stack>

      <Box sx={{ isolation: "isolate" }}>
        <IdeaTournamentDiagram />
      </Box>
    </Box>
  )
}
