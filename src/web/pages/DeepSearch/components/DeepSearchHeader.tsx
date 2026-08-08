import { Box, Typography } from "@mui/material"

export function DeepSearchHeader({ title = "Deep Search" }: { title?: string }) {
  return (
    <Box>
      <Typography component="h1" variant="h4" gutterBottom>
        {title}
      </Typography>
      <Typography color="text.secondary">
        Start a research job and review the search results it finds.
      </Typography>
    </Box>
  )
}
