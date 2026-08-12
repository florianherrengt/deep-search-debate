import { Button, Stack, Typography } from "@mui/material"
import { Link } from "react-router-dom"
import { useSeo } from "../lib/seo.ts"

type NotFoundProps = {
  title?: string
  message?: string
}

export function NotFound({
  title = "Page not found",
  message = "The page you requested does not exist.",
}: NotFoundProps) {
  useSeo({ title: "Page not found — RethinkLoop", noindex: true })

  return (
    <Stack spacing={2} sx={{ alignItems: "flex-start" }}>
      <Typography component="h1" variant="h4">
        {title}
      </Typography>
      <Typography color="text.secondary">{message}</Typography>
      <Button component={Link} to="/" variant="contained">
        Go home
      </Button>
    </Stack>
  )
}
