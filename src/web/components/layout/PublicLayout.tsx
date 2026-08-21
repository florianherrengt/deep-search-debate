import AppBar from "@mui/material/AppBar"
import Box from "@mui/material/Box"
import Button from "@mui/material/Button"
import Container from "@mui/material/Container"
import Toolbar from "@mui/material/Toolbar"
import type { ReactNode } from "react"
import type { ContainerProps } from "@mui/material/Container"
import { Link as RouterLink } from "react-router-dom"
import { JoinWaitlistButton } from "../waitlist/Waitlist.tsx"
import { AppFooter } from "./AppFooter.tsx"
import { BrandLink } from "./BrandLink.tsx"

interface PublicLayoutProps {
  authenticated?: boolean
  children: ReactNode
  maxWidth?: ContainerProps["maxWidth"]
}

function PublicHeader({ authenticated }: { authenticated: boolean }) {
  return (
    <AppBar position="static">
      <Toolbar sx={{ gap: 1, maxWidth: 1200, mx: "auto", width: "100%" }}>
        <Box sx={{ flexGrow: 1 }}>
          <BrandLink />
        </Box>
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
            color="inherit"
            component={RouterLink}
            size="small"
            to="/examples"
          >
            Examples
          </Button>
          {authenticated ? (
            <Button
              component={RouterLink}
              size="small"
              to="/debates"
              variant="contained"
            >
              Start your own debate
            </Button>
          ) : (
            <JoinWaitlistButton size="small" />
          )}
        </Box>
      </Toolbar>
    </AppBar>
  )
}

export function PublicLayout({
  authenticated = false,
  children,
  maxWidth = "lg",
}: PublicLayoutProps) {
  return (
    <Box
      sx={{ display: "flex", flexDirection: "column", minHeight: "100dvh" }}
    >
      <PublicHeader authenticated={authenticated} />
      <Container component="main" maxWidth={maxWidth} sx={{ flex: 1 }}>
        {children}
      </Container>
      <AppFooter />
    </Box>
  )
}
