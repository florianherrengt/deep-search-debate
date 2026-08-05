import { Container } from "@mui/material"
import type { Meta, StoryObj } from "@storybook/react"
import { TextStreamProvider } from "../useTextStream.ts"
import {
  completedRun,
  researchRequest,
  streamingPageSummariesRun,
  subscribeToStoryStream,
} from "./DeepSearchView.fixture.ts"
import { DeepSearchView } from "./DeepSearchView.tsx"

const meta: Meta<typeof DeepSearchView> = {
  title: "Pages/Deep Search",
  component: DeepSearchView,
  parameters: {
    layout: "fullscreen",
  },
  decorators: [
    (Story) => (
      <TextStreamProvider subscribe={subscribeToStoryStream}>
        <Container maxWidth="sm" sx={{ py: 4 }}>
          <Story />
        </Container>
      </TextStreamProvider>
    ),
  ],
}

export default meta

type Story = StoryObj<typeof DeepSearchView>

export const WithSearchResults: Story = {
  args: {
    researchRequest,
    run: completedRun,
  },
}

export const WithStreamingPageSummaries: Story = {
  args: {
    ...WithSearchResults.args,
    run: streamingPageSummariesRun,
  },
}
