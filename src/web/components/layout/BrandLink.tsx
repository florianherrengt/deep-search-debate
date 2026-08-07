import Typography from "@mui/material/Typography"
import { Link } from "react-router-dom"

export function BrandLink() {
  return (
    <Typography
      aria-label="Deep Search Debate home"
      component={Link}
      sx={{
        color: "text.primary",
        flexGrow: 1,
        fontWeight: 650,
        letterSpacing: "-0.02em",
        textDecoration: "none",
        whiteSpace: "nowrap",
        "&:focus-visible": {
          borderRadius: 1,
          outline: "2px solid",
          outlineColor: "primary.main",
          outlineOffset: 2,
        },
      }}
      to="/"
      variant="h6"
    >
      Deep Search Debate
    </Typography>
  )
}
