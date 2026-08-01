import { Container, CssBaseline } from "@mui/material"
import { ThemeProvider, createTheme } from "@mui/material/styles"
import type { Meta, StoryObj } from "@storybook/react"
import { TextStreamProvider } from "../useTextStream.ts"
import {
  completedRun,
  researchRequest,
  streamingPageSummariesRun,
  subscribeToStoryStream,
} from "./DeepSearchView.fixture.ts"
import { DeepSearchView } from "./DeepSearchView.tsx"

const theme = createTheme({
  colorSchemes: { dark: true },
  cssVariables: true,
})

const meta: Meta<typeof DeepSearchView> = {
  title: "Pages/Deep Search",
  component: DeepSearchView,
  parameters: {
    layout: "fullscreen",
  },
  decorators: [
    (Story) => (
      <ThemeProvider theme={theme}>
        <CssBaseline />
        <TextStreamProvider subscribe={subscribeToStoryStream}>
          <Container maxWidth="sm" sx={{ py: 4 }}>
            <Story />
          </Container>
        </TextStreamProvider>
      </ThemeProvider>
    ),
  ],
}

export default meta

type Story = StoryObj<typeof DeepSearchView>

export const WithSearchResults: Story = {
  args: {
    researchRequest,
    run: completedRun,
    onResearchRequestChange: () => undefined,
    onSubmit: (event) => event.preventDefault(),
  },
}

export const WithStreamingPageSummaries: Story = {
  args: {
    ...WithSearchResults.args,
    run: streamingPageSummariesRun,
  },
}
