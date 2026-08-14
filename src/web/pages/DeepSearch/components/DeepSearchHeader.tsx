import { Box, Typography } from "@mui/material"

export function DeepSearchHeader({
  description = "Start a research job and review the search results it finds.",
  title = "Deep Search",
}: {
  description?: string
  title?: string
}) {
  return (
    <Box>
      <Typography component="h1" variant="h4" gutterBottom>
        {title}
      </Typography>
      <Typography color="text.secondary">
        {description}
      </Typography>
    </Box>
  )
}
