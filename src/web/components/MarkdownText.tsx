import Box from "@mui/material/Box"
import Link from "@mui/material/Link"
import Table from "@mui/material/Table"
import TableBody from "@mui/material/TableBody"
import TableCell from "@mui/material/TableCell"
import TableContainer from "@mui/material/TableContainer"
import TableHead from "@mui/material/TableHead"
import TableRow from "@mui/material/TableRow"
import Typography from "@mui/material/Typography"
import type { SxProps, Theme } from "@mui/material/styles"
import { useId, useMemo } from "react"
import ReactMarkdown, { type Components } from "react-markdown"
import remarkGfm from "remark-gfm"

// Stable component identities preserve table focus and scrolling as tokens arrive.
const markdownComponents: Components = {
  table: ({ children }) => (
    <TableContainer
      aria-label="Scrollable table"
      role="region"
      tabIndex={0}
      sx={{
        my: 2,
        border: 1,
        borderColor: "divider",
        borderRadius: 1,
        "&:focus-visible": {
          outline: "2px solid",
          outlineColor: "primary.main",
          outlineOffset: 2,
        },
      }}
    >
      <Table size="small" sx={{
        "& th, & td": { minWidth: "8rem", verticalAlign: "top" },
        "& th": { bgcolor: "action.hover" },
      }}>
        {children}
      </Table>
    </TableContainer>
  ),
  thead: ({ children }) => <TableHead>{children}</TableHead>,
  tbody: ({ children }) => <TableBody>{children}</TableBody>,
  tr: ({ children }) => <TableRow>{children}</TableRow>,
  th: ({ children, style }) => <TableCell component="th" scope="col" style={style}>{children}</TableCell>,
  td: ({ children, style }) => <TableCell style={style}>{children}</TableCell>,
}

export function MarkdownText({
  sx,
  testId,
  text,
}: {
  sx?: SxProps<Theme>
  testId?: string
  text: string
}) {
  const id = useId()
  const components = useMemo<Components>(() => ({
    ...markdownComponents,
    a: ({ node: _node, ...props }) => (
      <Link
        {...props}
        aria-describedby={props["aria-describedby"] === "footnote-label" ? `${id}-footnote-label` : props["aria-describedby"]}
        rel="noopener noreferrer"
        target={props.href?.startsWith("#") ? undefined : "_blank"}
      />
    ),
    h2: ({ node: _node, ...props }) => (
      <h2 {...props} id={props.id === "footnote-label" ? `${id}-footnote-label` : props.id} />
    ),
  }), [id])
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
          components={components}
          remarkPlugins={[remarkGfm]}
          remarkRehypeOptions={{ clobberPrefix: `user-content-${id}-` }}
        >
          {text}
        </ReactMarkdown>
      </Typography>
    </Box>
  )
}
