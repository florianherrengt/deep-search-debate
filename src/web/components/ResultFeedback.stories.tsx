import Container from "@mui/material/Container"
import type { Meta, StoryObj } from "@storybook/react"
import { ResultFeedback } from "./ResultFeedback.tsx"

const meta: Meta<typeof ResultFeedback> = {
  title: "Components/Result feedback",
  component: ResultFeedback,
  decorators: [
    (Story) => (
      <Container maxWidth="sm" sx={{ py: 4 }}>
        <Story />
      </Container>
    ),
  ],
  args: {
    onRatingChange: () => Promise.resolve(),
    onSubmitText: () => Promise.resolve(),
    pending: false,
  },
}

export default meta
type Story = StoryObj<typeof ResultFeedback>

export const Unrated: Story = {
  args: {
    feedback: { rating: null, hasWrittenFeedback: false },
  },
}

export const Helpful: Story = {
  args: {
    feedback: { rating: true, hasWrittenFeedback: false },
  },
}

export const NotHelpful: Story = {
  args: {
    feedback: { rating: false, hasWrittenFeedback: false },
  },
}
