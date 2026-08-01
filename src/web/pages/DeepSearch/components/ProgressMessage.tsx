import { CircularProgress, Stack, Typography } from "@mui/material"
import type { ReactNode } from "react"

export function ProgressMessage({ children }: { children: ReactNode }) {
  return (
    <Stack direction="row" spacing={1} sx={{ alignItems: "center" }}>
      <CircularProgress size={20} />
      <Typography color="text.secondary">{children}</Typography>
    </Stack>
  )
}
