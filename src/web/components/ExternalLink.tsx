import OpenInNew from "@mui/icons-material/OpenInNew"
import { Link } from "@mui/material"
import type { LinkProps, SxProps, Theme } from "@mui/material"
import type { ReactNode } from "react"
import { Link as RouterLink } from "react-router-dom"

type ExternalLinkProps = (
  | { href: string; to?: undefined }
  | { href?: undefined; to: string }
) & {
  children: ReactNode
  color?: LinkProps["color"]
  sx?: SxProps<Theme>
}

export function ExternalLink({
  children,
  color,
  href,
  sx,
  to,
}: ExternalLinkProps) {
  const icon = (
    <OpenInNew
      aria-hidden="true"
      fontSize="inherit"
      sx={{ ml: 0.5, verticalAlign: "text-bottom" }}
    />
  )

  if (to !== undefined) {
    return (
      <Link
        color={color}
        component={RouterLink}
        rel="noopener noreferrer"
        sx={sx}
        target="_blank"
        to={to}
      >
        {children}
        {icon}
      </Link>
    )
  }

  return (
    <Link color={color} href={href} rel="noopener noreferrer" sx={sx} target="_blank">
      {children}
      {icon}
    </Link>
  )
}
