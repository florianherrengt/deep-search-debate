import { BrowserRouter, Link, Route, Routes } from "react-router-dom"
import { AppBar, Button, Container, Toolbar, Typography } from "@mui/material"
import { Home } from "./pages/Home.tsx"
import { About } from "./pages/About.tsx"
import { Chat } from "./pages/Chat.tsx"
import { DeepSearch } from "./pages/DeepSearch/index.tsx"

export function App() {
  return (
    <BrowserRouter>
      <AppBar position="static">
        <Toolbar>
          <Typography variant="h6" sx={{ flexGrow: 1 }}>
            Deep Search Debate
          </Typography>
          <Button color="inherit" component={Link} to="/">
            Home
          </Button>
          <Button color="inherit" component={Link} to="/chat">
            Chat
          </Button>
          <Button color="inherit" component={Link} to="/deep-search">
            Deep Search
          </Button>
          <Button color="inherit" component={Link} to="/about">
            About
          </Button>
        </Toolbar>
      </AppBar>
      <Container maxWidth="sm" sx={{ mt: 4 }}>
        <Routes>
          <Route path="/" element={<Home />} />
          <Route path="/chat" element={<Chat />} />
          <Route path="/deep-search" element={<DeepSearch />} />
          <Route path="/about" element={<About />} />
        </Routes>
      </Container>
    </BrowserRouter>
  )
}
