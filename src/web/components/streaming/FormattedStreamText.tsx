import Box from "@mui/material/Box"
import Link from "@mui/material/Link"
import List from "@mui/material/List"
import ListItem from "@mui/material/ListItem"
import ListItemText from "@mui/material/ListItemText"
import Typography from "@mui/material/Typography"
import ReactMarkdown from "react-markdown"

export type StreamTextFormat = "text" | "markdown" | "structured-list"

type StructuredListItem = {
  primary: string
  secondary?: string
}

function getStructuredListItem(value: unknown): StructuredListItem | undefined {
  if (typeof value === "string") return { primary: value }
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return undefined
  }

  const record = value as Record<string, unknown>
  if (typeof record.title !== "string") return undefined
  return {
    primary: record.title,
    ...(typeof record.prompt === "string"
      ? { secondary: record.prompt }
      : typeof record.description === "string"
        ? { secondary: record.description }
        : {}),
  }
}

function parseStructuredList(text: string): StructuredListItem[] | undefined {
  try {
    const parsed = JSON.parse(text) as unknown
    const elements =
      Array.isArray(parsed) ? parsed :
      typeof parsed === "object" && parsed !== null &&
          Array.isArray((parsed as { elements?: unknown }).elements)
        ? (parsed as { elements: unknown[] }).elements
        : undefined
    if (elements === undefined) return undefined

    const items = elements.map(getStructuredListItem)
    return items.every((item) => item !== undefined)
      ? items
      : undefined
  } catch {
    // Structured streams are incomplete while tokens are still arriving.
    return undefined
  }
}

function PlainText({ text, testId }: { text: string; testId: string }) {
  return (
    <Typography
      data-testid={testId}
      variant="body2"
      sx={{
        maxWidth: "85ch",
        overflowWrap: "anywhere",
        whiteSpace: "pre-wrap",
      }}
    >
      {text}
    </Typography>
  )
}

function MarkdownText({ text, testId }: { text: string; testId: string }) {
  return (
    <Box
      data-testid={testId}
      sx={{
        maxWidth: "85ch",
        overflowWrap: "anywhere",
        "& > :first-of-type": { mt: 0 },
        "& > :last-of-type": { mb: 0 },
        "& h1": { fontSize: "1.4rem" },
        "& h2": { fontSize: "1.25rem" },
        "& h3, & h4, & h5, & h6": { fontSize: "1rem" },
        "& h1, & h2, & h3, & h4, & h5, & h6": {
          fontWeight: 600,
          lineHeight: 1.35,
          mb: 1,
          mt: 2.5,
        },
        "& p": { fontSize: "0.875rem", lineHeight: 1.6, my: 1 },
        "& ul, & ol": { my: 1, pl: 3 },
        "& li": { fontSize: "0.875rem", lineHeight: 1.6, mb: 0.5 },
        "& code": {
          bgcolor: "action.hover",
          borderRadius: 0.5,
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
    </Box>
  )
}

function StructuredList({
  items,
  testId,
}: {
  items: StructuredListItem[]
  testId: string
}) {
  return (
    <List
      component="ol"
      data-testid={testId}
      disablePadding
      sx={{ listStyle: "decimal", maxWidth: "85ch", pl: 3 }}
    >
      {items.map((item, index) => (
        <ListItem
          // Model output has no stable identity before the stream completes.
          // eslint-disable-next-line @eslint-react/no-array-index-key
          key={index}
          disableGutters
          sx={{ display: "list-item", py: 0.25 }}
        >
          <ListItemText
            primary={item.primary}
            secondary={item.secondary}
            slotProps={{
              primary: { variant: "body2" },
              secondary: { variant: "body2" },
            }}
          />
        </ListItem>
      ))}
    </List>
  )
}

export function FormattedStreamText({
  format,
  text,
  testId,
}: {
  format: StreamTextFormat
  text: string
  testId: string
}) {
  if (format === "markdown") {
    return <MarkdownText text={text} testId={testId} />
  }
  if (format === "structured-list") {
    const items = parseStructuredList(text)
    if (items !== undefined) {
      return <StructuredList items={items} testId={testId} />
    }
  }
  return <PlainText text={text} testId={testId} />
}
