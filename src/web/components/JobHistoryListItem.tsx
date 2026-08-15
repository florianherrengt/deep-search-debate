import Box from "@mui/material/Box"
import ListItem from "@mui/material/ListItem"
import ListItemButton from "@mui/material/ListItemButton"
import ListItemText from "@mui/material/ListItemText"
import Stack from "@mui/material/Stack"
import Typography from "@mui/material/Typography"
import type { ReactNode } from "react"
import { Link } from "react-router-dom"
import { getPromptExcerpt } from "../lib/promptPresentation.ts"

export function JobHistoryListItem({
  date,
  label,
  origin,
  prompt,
  status,
  to,
}: {
  date: string
  label: string
  origin?: ReactNode
  prompt: string
  status: ReactNode
  to: string
}) {
  return (
    <ListItem
      disablePadding
      divider
      sx={{
        alignItems: "stretch",
        flexDirection: "column",
      }}
    >
      <ListItemButton
        component={Link}
        sx={{
          display: "block",
          px: 2,
          py: 1.5,
          width: "100%",
        }}
        to={to}
      >
        <Stack spacing={0.5}>
          <Stack
            direction={{ xs: "column", sm: "row" }}
            spacing={{ xs: 1, sm: 2 }}
            sx={{ alignItems: { xs: "flex-start", sm: "center" } }}
          >
            <ListItemText
              primary={label}
              secondary={
                <Typography
                  color="text.secondary"
                  component="span"
                  sx={{ overflowWrap: "anywhere" }}
                  variant="body2"
                >
                  {getPromptExcerpt(prompt)}
                </Typography>
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
            <Stack
              sx={{
                alignSelf: { xs: "flex-start", sm: "center" },
                flexShrink: 0,
              }}
            >
              {status}
            </Stack>
          </Stack>
          <Typography color="text.secondary" component="span" variant="caption">
            {date}
          </Typography>
        </Stack>
      </ListItemButton>
      {origin ? <Box sx={{ px: 2, pb: 1.5 }}>{origin}</Box> : null}
    </ListItem>
  )
}
