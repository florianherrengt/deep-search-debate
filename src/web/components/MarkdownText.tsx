import Box from "@mui/material/Box"
import Link from "@mui/material/Link"
import Typography from "@mui/material/Typography"
import type { SxProps, Theme } from "@mui/material/styles"
import ReactMarkdown from "react-markdown"

export function MarkdownText({
  sx,
  testId,
  text,
}: {
  sx?: SxProps<Theme>
  testId?: string
  text: string
}) {
  return (
    <Box data-testid={testId} sx={sx}>
      <Typography
        color="text.secondary"
        component="div"
        sx={{
          overflowWrap: "anywhere",
          "& > :first-of-type": { mt: 0 },
          "& > :last-of-type": { mb: 0 },
          "& h1": { fontSize: "1.4rem" },
          "& h2": { fontSize: "1.25rem" },
          "& h3, & h4, & h5, & h6": { fontSize: "1.0625rem" },
          "& h1, & h2, & h3, & h4, & h5, & h6": {
            fontWeight: 600,
            lineHeight: 1.35,
            mb: 1,
            mt: 2.5,
          },
          "& p": { my: 1 },
          "& ul, & ol": { my: 1, pl: 3 },
          "& li": { mb: 0.5 },
          "& code": {
            bgcolor: "action.hover",
            borderRadius: 1,
            fontFamily: "monospace",
            px: 0.5,
          },
          "& pre": {
            bgcolor: "action.hover",
            borderRadius: 1,
            overflowX: "auto",
            p: 1.5,
          },
          "& pre code": { bgcolor: "transparent", p: 0 },
        }}
      >
        <ReactMarkdown
          components={{
            a: ({ children, href }) => (
              <Link href={href} rel="noopener noreferrer" target="_blank">
                {children}
              </Link>
            ),
          }}
        >
          {text}
        </ReactMarkdown>
      </Typography>
    </Box>
  )
}
