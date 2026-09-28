import List from "@mui/material/List"
import ListItem from "@mui/material/ListItem"
import ListItemText from "@mui/material/ListItemText"
import Typography from "@mui/material/Typography"
import Stack from "@mui/material/Stack"
import z from "zod"
import { ExternalLink } from "../ExternalLink.tsx"
import { MarkdownText } from "../MarkdownText.tsx"

export type StreamTextFormat = "text" | "markdown" | "structured-list" | "research-plan" | "discovery-inventory"

const discoveryInventorySchema = z.object({
  options: z.array(z.object({
    name: z.string().trim().min(1),
    category: z.string().trim().min(1),
    description: z.string().trim().min(1),
    sources: z.array(z.url({ protocol: /^https?$/ })).min(1),
  })).min(1),
})

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
      typeof parsed === "object" && parsed !== null && "version" in parsed &&
          parsed.version === 1 && "queries" in parsed && Array.isArray(parsed.queries) &&
          parsed.queries.every((query: unknown) => typeof query === "string")
        ? parsed.queries :
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
  fallbackText,
}: {
  format: StreamTextFormat
  text: string
  testId: string
  fallbackText?: string
}) {
  if (format === "discovery-inventory") {
    let inventory: z.infer<typeof discoveryInventorySchema> | undefined
    try {
      const parsed = discoveryInventorySchema.safeParse(JSON.parse(text) as unknown)
      if (parsed.success) inventory = parsed.data
    } catch {
      // Incomplete structured output is never displayed as a provider envelope.
    }
    if (!inventory) {
      return <PlainText text={fallbackText ?? "No option list was saved."} testId={testId} />
    }
    return (
      <Stack spacing={2} data-testid={testId}>
        <Typography color="text.secondary" variant="body2">
          {inventory.options.length} options discovered
        </Typography>
        {[...Map.groupBy(inventory.options, (option) => option.category)].map(([category, options]) => (
          <Stack spacing={0.5} key={category}>
            <Typography component="p" variant="subtitle2">{category}</Typography>
            <List aria-label={category} component="ul" disablePadding sx={{ listStyle: "disc", pl: 3 }}>
              {options.map((option) => (
                <ListItem key={option.name} disableGutters sx={{ display: "list-item", overflowWrap: "anywhere" }}>
                  <ListItemText primary={option.name} secondary={option.description} />
                  <Stack direction="row" spacing={1} sx={{ flexWrap: "wrap" }}>
                    {option.sources.map((source, index) => (
                      <ExternalLink key={source} href={source}>Source {index + 1}</ExternalLink>
                    ))}
                  </Stack>
                </ListItem>
              ))}
            </List>
          </Stack>
        ))}
      </Stack>
    )
  }
  if (format === "markdown") {
    return (
      <MarkdownText
        sx={{ fontSize: "0.875rem", maxWidth: "85ch" }}
        testId={testId}
        text={text}
      />
    )
  }
  if (format === "structured-list" || format === "research-plan") {
    const items = parseStructuredList(text)
    if (items !== undefined) {
      return <StructuredList items={items} testId={testId} />
    }
    if (format === "research-plan") {
      return <PlainText text={fallbackText ?? "No search queries were saved."} testId={testId} />
    }
  }
  return <PlainText text={text} testId={testId} />
}
