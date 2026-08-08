import AppBar from "@mui/material/AppBar"
import Box from "@mui/material/Box"
import Button from "@mui/material/Button"
import Container from "@mui/material/Container"
import Link from "@mui/material/Link"
import Stack from "@mui/material/Stack"
import Toolbar from "@mui/material/Toolbar"
import Typography from "@mui/material/Typography"
import type { ReactNode } from "react"
import type { ContainerProps } from "@mui/material/Container"
import { Link as RouterLink } from "react-router-dom"
import { BrandLink } from "./BrandLink.tsx"

interface PublicLayoutProps {
  children: ReactNode
  maxWidth?: ContainerProps["maxWidth"]
}

function PublicHeader() {
  return (
    <AppBar position="static">
      <Toolbar sx={{ gap: 1, maxWidth: 1200, mx: "auto", width: "100%" }}>
        <BrandLink />
        <Box
          aria-label="Landing page navigation"
          component="nav"
          sx={{ alignItems: "center", display: "flex", gap: 0.5 }}
        >
          <Button
            color="inherit"
            component="a"
            href="/#how-it-works"
            size="small"
            sx={{ display: { xs: "none", md: "inline-flex" } }}
          >
            How it works
          </Button>
          <Button
            component={RouterLink}
            size="small"
            to="/debates"
            variant="contained"
          >
            Start your own debate
          </Button>
        </Box>
      </Toolbar>
    </AppBar>
  )
}

function PublicFooter() {
  return (
    <Box
      component="footer"
      sx={{ borderTop: 1, borderColor: "divider", mt: "auto" }}
    >
      <Container maxWidth="lg" sx={{ py: 3 }}>
        <Stack
          direction={{ xs: "column", sm: "row" }}
          spacing={2}
          sx={{
            alignItems: { sm: "center" },
            justifyContent: "space-between",
          }}
        >
          <Stack spacing={0.5}>
            <Typography component="p" variant="subtitle2">
              Deep Search Debate
            </Typography>
            <Typography color="text.secondary" variant="caption">
              Better ideas through debate.
            </Typography>
          </Stack>
          <Stack
            aria-label="Legal"
            component="nav"
            direction="row"
            spacing={2.5}
          >
            <Link color="text.secondary" component={RouterLink} to="/terms">
              Terms &amp; Conditions
            </Link>
            <Link color="text.secondary" component={RouterLink} to="/privacy">
              Privacy Policy
            </Link>
          </Stack>
        </Stack>
      </Container>
    </Box>
  )
}

export function PublicLayout({
  children,
  maxWidth = "lg",
}: PublicLayoutProps) {
  return (
    <Box
      sx={{ display: "flex", flexDirection: "column", minHeight: "100dvh" }}
    >
      <PublicHeader />
      <Container component="main" maxWidth={maxWidth} sx={{ flex: 1 }}>
        {children}
      </Container>
      <PublicFooter />
    </Box>
  )
}
