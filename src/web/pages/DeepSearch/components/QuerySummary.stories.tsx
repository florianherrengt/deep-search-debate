import { Paper } from "@mui/material"
import type { Meta, StoryObj } from "@storybook/react"
import type { TextStreamEvent } from "../../../lib/textStreams.ts"
import { TextStreamProvider } from "../useTextStream.ts"
import { QuerySummary } from "./QuerySummary.tsx"

async function* subscribeToStoryStream(
  id: string,
  signal?: AbortSignal,
): AsyncGenerator<TextStreamEvent> {
  if (id === "streaming-query-summary") {
    yield {
      type: "reasoning",
      text: "I am combining the explored pages with the remaining search descriptions.",
    }
    yield {
      type: "text",
      text: "The search results consistently recommend stable, flexible longboards for beginners. The explored sources add",
    }
    await new Promise<void>((resolve) => {
      if (signal?.aborted) resolve()
      else signal?.addEventListener("abort", () => resolve(), { once: true })
    })
    return
  }

  if (id === "failed-query-summary") {
    yield { type: "error", message: "Query summary generation failed" }
    return
  }

  yield {
    type: "reasoning",
    text: "I will retain the findings that directly answer the user's request.",
  }
  yield {
    type: "text",
    text: "The search results favour drop-through longboards with medium-flex decks for beginner cruising. Explored sources consistently highlight stability and predictable turning, while the remaining listings suggest comparing rider weight limits and wheel hardness before buying.",
  }
  yield { type: "done" }
}

const meta: Meta<typeof QuerySummary> = {
  title: "Pages/Deep Search/Search Findings",
  component: QuerySummary,
  decorators: [
    (Story) => (
      <TextStreamProvider subscribe={subscribeToStoryStream}>
        <Paper variant="outlined" sx={{ p: 2, maxWidth: 700 }}>
          <Story />
        </Paper>
      </TextStreamProvider>
    ),
  ],
}

export default meta

type Story = StoryObj<typeof QuerySummary>

const query = "best beginner longboards for cruising"

export const Streaming: Story = {
  args: {
    query,
    streamId: "streaming-query-summary",
  },
}

export const Completed: Story = {
  args: {
    query,
    streamId: "completed-query-summary",
  },
}

export const Failed: Story = {
  args: {
    query,
    streamId: "failed-query-summary",
  },
}
