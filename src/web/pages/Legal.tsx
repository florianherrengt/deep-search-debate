import ArrowBackRounded from "@mui/icons-material/ArrowBackRounded"
import Button from "@mui/material/Button"
import Paper from "@mui/material/Paper"
import Stack from "@mui/material/Stack"
import Typography from "@mui/material/Typography"
import { useEffect, useRef } from "react"
import { Link } from "react-router-dom"

interface LegalPageProps {
  title: string
}

export function LegalPage({ title }: LegalPageProps) {
  const headingRef = useRef<HTMLHeadingElement>(null)

  useEffect(() => {
    window.scrollTo({ behavior: "auto", left: 0, top: 0 })
    headingRef.current?.focus({ preventScroll: true })
  }, [])

  return (
    <Stack
      component="article"
      spacing={4}
      sx={{ maxWidth: "72ch", py: { xs: 6, md: 10 } }}
    >
      <Stack spacing={1.5}>
        <Typography color="primary.main" variant="overline">
          Legal
        </Typography>
        <Typography
          component="h1"
          ref={headingRef}
          sx={{ outline: "none" }}
          tabIndex={-1}
          variant="h3"
        >
          {title}
        </Typography>
      </Stack>

      <Paper sx={{ p: { xs: 2.5, sm: 3.5 } }} variant="outlined">
        <Stack spacing={1.5}>
          <Typography component="h2" variant="h5">
            Policy coming soon
          </Typography>
          <Typography color="text.secondary">
            This page is a placeholder. The complete policy will be published
            before the service is made generally available.
          </Typography>
        </Stack>
      </Paper>

      <Button
        component={Link}
        startIcon={<ArrowBackRounded />}
        sx={{ alignSelf: "flex-start" }}
        to="/"
        variant="outlined"
      >
        Back to home
      </Button>
    </Stack>
  )
}
