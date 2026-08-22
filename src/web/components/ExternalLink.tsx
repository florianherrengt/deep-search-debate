import OpenInNew from "@mui/icons-material/OpenInNew"
import { Button, Link } from "@mui/material"
import type { ButtonProps, LinkProps, SxProps, Theme } from "@mui/material"
import type { ReactNode } from "react"
import { Link as RouterLink } from "react-router-dom"

type DestinationProps =
  | { href: string; to?: undefined }
  | { href?: undefined; to: string }

type ExternalLinkProps =
  | (DestinationProps & {
      children: ReactNode
      color?: LinkProps["color"]
      sx?: SxProps<Theme>
      variant?: "link"
    })
  | (DestinationProps & {
      children: ReactNode
      buttonVariant?: ButtonProps["variant"]
      size?: ButtonProps["size"]
      sx?: SxProps<Theme>
      variant: "button"
    })

export function ExternalLink(props: ExternalLinkProps) {
  const { children, sx } = props

  if (props.variant === "button") {
    const buttonProps = {
      endIcon: <OpenInNew aria-hidden="true" />,
      rel: "noopener noreferrer",
      size: props.size,
      sx,
      target: "_blank",
      variant: props.buttonVariant ?? "outlined",
    }
    return props.to !== undefined ? (
      <Button component={RouterLink} to={props.to} {...buttonProps}>
        {children}
      </Button>
    ) : (
      <Button href={props.href} {...buttonProps}>
        {children}
      </Button>
    )
  }

  const { color, href, to } = props
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
    <Link
      color={color}
      href={href}
      rel="noopener noreferrer"
      sx={sx}
      target="_blank"
    >
      {children}
      {icon}
    </Link>
  )
}
