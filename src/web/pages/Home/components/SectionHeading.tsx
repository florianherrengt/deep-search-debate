import Stack from "@mui/material/Stack"
import Typography from "@mui/material/Typography"
import { sectionTitleSx } from "../landingStyles.ts"

interface SectionHeadingProps {
  eyebrow: string
  id: string
  subtitle: string
  title: string
}

export function SectionHeading({
  eyebrow,
  id,
  subtitle,
  title,
}: SectionHeadingProps) {
  return (
    <Stack spacing={1.5} sx={{ maxWidth: 720 }}>
      <Typography color="primary.main" variant="overline">
        {eyebrow}
      </Typography>
      <Typography
        component="h2"
        id={id}
        sx={sectionTitleSx}
        variant="h2"
      >
        {title}
      </Typography>
      <Typography color="text.secondary" variant="body1">
        {subtitle}
      </Typography>
    </Stack>
  )
}
