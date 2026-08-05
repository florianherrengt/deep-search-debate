import { Paper } from "@mui/material"
import type { Meta, StoryObj } from "@storybook/react"
import { TextStreamProvider } from "../../../components/streaming/useTextStream.ts"
import { subscribeToStoryStream } from "./DeepSearchView.fixture.ts"
import { QuerySummary } from "./QuerySummary.tsx"

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
