import { Paper } from "@mui/material"
import type { Meta, StoryObj } from "@storybook/react"
import type { TextStreamEvent } from "../../../lib/textStreams.ts"
import { TextStreamProvider } from "../useTextStream.ts"
import { PageSummary } from "./PageSummary.tsx"

async function* subscribeToStoryStream(
  id: string,
  signal?: AbortSignal,
): AsyncGenerator<TextStreamEvent> {
  if (id === "streaming-summary") {
    yield {
      type: "reasoning",
      text: "I am extracting the product claims that answer the research request.",
    }
    yield {
      type: "text",
      text: "The page describes ChatGPT, the API platform, and enterprise products. It emphasises",
    }
    await new Promise<void>((resolve) => {
      if (signal?.aborted) resolve()
      else signal?.addEventListener("abort", () => resolve(), { once: true })
    })
    return
  }

  yield {
    type: "reasoning",
    text: "The page is a primary source, so I will prioritize its product descriptions.",
  }
  yield {
    type: "text",
    text: "The page is a primary source for OpenAI's current product portfolio. It describes ChatGPT offerings for individuals and organisations alongside an API platform for developers.",
  }
  yield { type: "done" }
}

const meta: Meta<typeof PageSummary> = {
  title: "Pages/Deep Search/Source Findings",
  component: PageSummary,
  decorators: [
    (Story) => (
      <TextStreamProvider subscribe={subscribeToStoryStream}>
        <Paper variant="outlined" sx={{ p: 2, maxWidth: 600 }}>
          <Story />
        </Paper>
      </TextStreamProvider>
    ),
  ],
}

export default meta

type Story = StoryObj<typeof PageSummary>

export const Extracting: Story = {
  args: {
    summary: { status: "extracting" },
  },
}

export const Streaming: Story = {
  args: {
    summary: {
      status: "stream",
      streamId: "streaming-summary",
    },
  },
}

export const Completed: Story = {
  args: {
    summary: {
      status: "stream",
      streamId: "completed-summary",
    },
  },
}

export const Failed: Story = {
  args: {
    summary: {
      status: "error",
      message: "The page could not be extracted.",
    },
  },
}
