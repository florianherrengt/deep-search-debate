import {
  BrowserRouter,
  Link,
  Route,
  Routes,
  useLocation,
} from "react-router-dom"
import { useEffect, useRef } from "react"
import {
  AppBar,
  Alert,
  Avatar,
  Box,
  Button,
  Container,
  Stack,
  Toolbar,
  Typography,
} from "@mui/material"
import { Home } from "./pages/Home.tsx"
import { About } from "./pages/About.tsx"
import { DeepSearch } from "./pages/DeepSearch/index.tsx"
import { Ideas } from "./pages/Ideas/index.tsx"
import { Debates } from "./pages/Debates/index.tsx"
import { NotFound } from "./components/NotFound.tsx"
import { AuthGate } from "./components/auth/AuthGate.tsx"
import type { AuthSession } from "./lib/authClient.ts"

const navigationItems = [
  { label: "Home", to: "/" },
  { label: "Deep Search", to: "/deep-search" },
  { label: "Ideas", to: "/ideas" },
  { label: "Debates", to: "/debates" },
  { label: "About", to: "/about" },
] as const

function isCurrentRoute(pathname: string, destination: string): boolean {
  if (destination === "/") return pathname === destination
  return pathname === destination || pathname.startsWith(`${destination}/`)
}

interface AppNavigationProps {
  authError?: string
  session: AuthSession
  signingOut: boolean
  signOut: () => Promise<void>
}

function AppNavigation({ session, signingOut, signOut }: AppNavigationProps) {
  const location = useLocation()

  return (
    <AppBar position="static">
      <Toolbar
        sx={{
          columnGap: { xs: 1, sm: 3 },
          flexWrap: { xs: "wrap", sm: "nowrap" },
          maxWidth: 1536,
          mx: "auto",
          py: { xs: 0.5, sm: 0.5 },
          rowGap: { xs: 0.25, sm: 0.75 },
          width: "100%",
        }}
      >
        <Typography
          aria-label="Deep Search Debate home"
          color="text.primary"
          component={Link}
          sx={{
            flexGrow: 1,
            fontWeight: 650,
            letterSpacing: "-0.02em",
            textDecoration: "none",
            whiteSpace: "nowrap",
            "&:focus-visible": {
              borderRadius: 1,
              outline: "2px solid",
              outlineColor: "primary.main",
              outlineOffset: 2,
            },
          }}
          to="/"
          variant="h6"
        >
          Deep Search Debate
        </Typography>
        <Stack direction="row" spacing={1} sx={{ alignItems: "center" }}>
          <Avatar
            alt=""
            src={session.user.image ?? undefined}
            sx={{ height: 30, width: 30 }}
          >
            {session.user.name.slice(0, 1).toUpperCase()}
          </Avatar>
          <Typography
            color="text.secondary"
            sx={{ display: { xs: "none", md: "block" }, maxWidth: 180 }}
            noWrap
            variant="body2"
          >
            {session.user.name}
          </Typography>
          <Button
            color="inherit"
            disabled={signingOut}
            onClick={() => void signOut()}
            size="small"
          >
            {signingOut ? "Signing out…" : "Sign out"}
          </Button>
        </Stack>
        <Box
          aria-label="Primary navigation"
          component="nav"
          sx={{
            display: "flex",
            flexBasis: { xs: "100%", sm: "auto" },
            gap: { xs: 0, sm: 0.25 },
            justifyContent: { xs: "space-between", sm: "flex-end" },
            mx: 0,
            overflowX: "auto",
            scrollbarWidth: "none",
            width: { xs: "100%", sm: "auto" },
            "&::-webkit-scrollbar": { display: "none" },
          }}
        >
          {navigationItems.map((item) => {
            const current = isCurrentRoute(location.pathname, item.to)
            return (
              <Button
                key={item.to}
                aria-current={current ? "page" : undefined}
                color="inherit"
                component={Link}
                size="small"
                sx={{
                  bgcolor: current ? "action.selected" : "transparent",
                  color: current ? "text.primary" : "text.secondary",
                  flexShrink: 0,
                  minHeight: { xs: 44, sm: 32 },
                  minWidth: 0,
                  px: { xs: 0.5, sm: 1.25 },
                  "&:hover": {
                    bgcolor: current ? "action.selected" : "action.hover",
                    color: "text.primary",
                  },
                }}
                to={item.to}
              >
                {item.label}
              </Button>
            )
          })}
        </Box>
      </Toolbar>
    </AppBar>
  )
}

function RoutedContent() {
  const location = useLocation()
  const mainRef = useRef<HTMLElement>(null)
  const previousPathnameRef = useRef(location.pathname)
  const isDebateDetail = /^\/debates\/[^/]+\/?$/.test(location.pathname)
  const isResearchDetail = /^\/(deep-search|ideas)\/[^/]+\/?$/.test(
    location.pathname,
  )

  useEffect(() => {
    if (previousPathnameRef.current === location.pathname) return
    previousPathnameRef.current = location.pathname
    window.scrollTo({ behavior: "auto", left: 0, top: 0 })
    const heading = mainRef.current?.querySelector<HTMLElement>("h1")
    const focusTarget = heading ?? mainRef.current
    if (heading) heading.tabIndex = -1
    focusTarget?.focus({ preventScroll: true })
  }, [location.pathname])

  return (
    <Container
      component="main"
      maxWidth={isDebateDetail ? "xl" : isResearchDetail ? "lg" : "md"}
      ref={mainRef}
      sx={{
        flex: 1,
        outline: "none",
        py: { xs: 3, sm: 4.5 },
      }}
      tabIndex={-1}
    >
      <Routes>
        <Route path="/" element={<Home />} />
        <Route path="/deep-search" element={<DeepSearch />} />
        <Route
          path="/deep-search/:deepSearchJobId"
          element={<DeepSearch />}
        />
        <Route path="/ideas" element={<Ideas />} />
        <Route path="/ideas/:ideaJobId" element={<Ideas />} />
        <Route path="/debates" element={<Debates />} />
        <Route path="/debates/:debateJobId" element={<Debates />} />
        <Route path="/about" element={<About />} />
        <Route path="*" element={<NotFound />} />
      </Routes>
    </Container>
  )
}

function AuthenticatedApp({
  authError,
  session,
  signingOut,
  signOut,
}: AppNavigationProps) {
  return (
    <Box sx={{ display: "flex", flexDirection: "column", minHeight: "100dvh" }}>
      <AppNavigation session={session} signingOut={signingOut} signOut={signOut} />
      {authError === undefined ? null : (
        <Alert severity="error">{authError}</Alert>
      )}
      <RoutedContent />
    </Box>
  )
}

export function App() {
  return (
    <BrowserRouter>
      <AuthGate>
        {(props) => <AuthenticatedApp {...props} />}
      </AuthGate>
    </BrowserRouter>
  )
}
