import { Box, ListItemButton, ListItemText, Stack, Typography } from "@mui/material"
import type { ReactNode } from "react"
import { Link } from "react-router-dom"
import { getPromptExcerpt } from "../lib/promptPresentation.ts"

export function JobHistoryListItem({
  date,
  label,
  prompt,
  status,
  to,
}: {
  date: string
  label: string
  prompt: string
  status: ReactNode
  to: string
}) {
  return (
    <ListItemButton
      component={Link}
      divider
      sx={{
        alignItems: { xs: "flex-start", sm: "center" },
        flexDirection: { xs: "column", sm: "row" },
        gap: { xs: 1, sm: 2 },
        py: 1.5,
      }}
      to={to}
    >
      <ListItemText
        primary={label}
        secondary={
          <Stack component="span" spacing={0.25} sx={{ mt: 0.5 }}>
            <Typography
              color="text.secondary"
              component="span"
              sx={{ overflowWrap: "anywhere" }}
              variant="body2"
            >
              {getPromptExcerpt(prompt)}
            </Typography>
            <Typography color="text.secondary" component="span" variant="caption">
              {date}
            </Typography>
          </Stack>
        }
        slotProps={{
          primary: {
            sx: {
              display: "-webkit-box",
              overflow: "hidden",
              overflowWrap: "anywhere",
              WebkitBoxOrient: "vertical",
              WebkitLineClamp: { xs: 3, sm: 2 },
            },
          },
        }}
        sx={{ m: 0, minWidth: 0, width: "100%" }}
      />
      <Box
        sx={{
          alignSelf: { xs: "flex-start", sm: "center" },
          flexShrink: 0,
        }}
      >
        {status}
      </Box>
    </ListItemButton>
  )
}
