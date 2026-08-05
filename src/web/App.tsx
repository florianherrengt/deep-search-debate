import {
  BrowserRouter,
  Link,
  Route,
  Routes,
  useLocation,
} from "react-router-dom"
import { AppBar, Button, Container, Toolbar, Typography } from "@mui/material"
import { Home } from "./pages/Home.tsx"
import { About } from "./pages/About.tsx"
import { DeepSearch } from "./pages/DeepSearch/index.tsx"
import { Ideas } from "./pages/Ideas/index.tsx"
import { Debates } from "./pages/Debates/index.tsx"

function RoutedContent() {
  const location = useLocation()
  const isDebateDetail = /^\/debates\/[^/]+\/?$/.test(location.pathname)

  return (
    <Container maxWidth={isDebateDetail ? "xl" : "sm"} sx={{ mt: 4 }}>
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
      </Routes>
    </Container>
  )
}

export function App() {
  return (
    <BrowserRouter>
      <AppBar position="static">
        <Toolbar sx={{ flexWrap: "wrap", py: { xs: 1, sm: 0 } }}>
          <Typography
            variant="h6"
            sx={{
              flexBasis: { xs: "100%", sm: "auto" },
              flexGrow: 1,
              textAlign: { xs: "center", sm: "left" },
            }}
          >
            Deep Search Debate
          </Typography>
          <Button color="inherit" component={Link} to="/">
            Home
          </Button>
          <Button color="inherit" component={Link} to="/deep-search">
            Deep Search
          </Button>
          <Button color="inherit" component={Link} to="/ideas">
            Ideas
          </Button>
          <Button color="inherit" component={Link} to="/debates">
            Debates
          </Button>
          <Button color="inherit" component={Link} to="/about">
            About
          </Button>
        </Toolbar>
      </AppBar>
      <RoutedContent />
    </BrowserRouter>
  )
}
