import List from "@mui/material/List"
import ListItem from "@mui/material/ListItem"
import ListItemText from "@mui/material/ListItemText"
import Typography from "@mui/material/Typography"
import { MarkdownText } from "../MarkdownText.tsx"

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
    return (
      <MarkdownText
        sx={{ fontSize: "0.875rem", maxWidth: "85ch" }}
        testId={testId}
        text={text}
      />
    )
  }
  if (format === "structured-list") {
    const items = parseStructuredList(text)
    if (items !== undefined) {
      return <StructuredList items={items} testId={testId} />
    }
  }
  return <PlainText text={text} testId={testId} />
}
