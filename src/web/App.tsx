import {
  BrowserRouter,
  Link,
  Route,
  Routes,
  useLocation,
} from "react-router-dom"
import {
  AppBar,
  Box,
  Button,
  Container,
  Toolbar,
  Typography,
} from "@mui/material"
import { Home } from "./pages/Home.tsx"
import { About } from "./pages/About.tsx"
import { DeepSearch } from "./pages/DeepSearch/index.tsx"
import { Ideas } from "./pages/Ideas/index.tsx"
import { Debates } from "./pages/Debates/index.tsx"
import { NotFound } from "./components/NotFound.tsx"

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

function AppNavigation() {
  const location = useLocation()

  return (
    <AppBar position="static">
      <Toolbar
        sx={{
          columnGap: { xs: 1, sm: 3 },
          flexWrap: { xs: "wrap", sm: "nowrap" },
          maxWidth: 1536,
          mx: "auto",
          py: { xs: 1, sm: 0.5 },
          rowGap: 0.75,
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
  const isDebateDetail = /^\/debates\/[^/]+\/?$/.test(location.pathname)
  const isResearchDetail = /^\/(deep-search|ideas)\/[^/]+\/?$/.test(
    location.pathname,
  )

  return (
    <Container
      component="main"
      maxWidth={isDebateDetail ? "xl" : isResearchDetail ? "lg" : "md"}
      sx={{
        flex: 1,
        py: { xs: 3, sm: 4.5 },
      }}
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

export function App() {
  return (
    <BrowserRouter>
      <Box
        sx={{ display: "flex", flexDirection: "column", minHeight: "100dvh" }}
      >
        <AppNavigation />
        <RoutedContent />
      </Box>
    </BrowserRouter>
  )
}
