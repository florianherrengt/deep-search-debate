import { Paper } from "@mui/material"
import type { Meta, StoryObj } from "@storybook/react"
import { TextStreamProvider } from "../../../components/streaming/useTextStream.ts"
import { subscribeToStoryStream } from "./DeepSearchView.fixture.ts"
import { PageSummary } from "./PageSummary.tsx"

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
