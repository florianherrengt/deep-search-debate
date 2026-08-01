import { Box, Typography } from "@mui/material"

export function DeepSearchHeader() {
  return (
    <Box>
      <Typography variant="h4" gutterBottom>
        Deep Search
      </Typography>
      <Typography color="text.secondary">
        Start a research job and review the search results it finds.
      </Typography>
    </Box>
  )
}
