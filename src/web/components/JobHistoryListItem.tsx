import { Box, ListItemButton, ListItemText } from "@mui/material"
import type { ReactNode } from "react"
import { Link } from "react-router-dom"

export function JobHistoryListItem({
  date,
  label,
  status,
  to,
}: {
  date: string
  label: string
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
        secondary={date}
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
          secondary: { sx: { mt: 0.25 } },
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
