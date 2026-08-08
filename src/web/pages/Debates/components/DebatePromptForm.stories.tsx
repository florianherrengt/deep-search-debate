import { Container } from "@mui/material"
import type { Meta, StoryObj } from "@storybook/react"
import { DebatePromptForm } from "./DebatePromptForm.tsx"

const meta: Meta<typeof DebatePromptForm> = {
  title: "Pages/Debates/Prompt",
  component: DebatePromptForm,
  parameters: { layout: "fullscreen" },
  decorators: [
    (Story) => (
      <Container maxWidth="md" sx={{ py: 4 }}>
        <Story />
      </Container>
    ),
  ],
}

export default meta
type Story = StoryObj<typeof DebatePromptForm>

export const Ready: Story = {
  args: { onSubmit: () => undefined },
}

export const ReadyToPublish: Story = {
  args: { initialIsPublic: true, onSubmit: () => undefined },
}

export const StartingTournament: Story = {
  args: { isStarting: true, onSubmit: () => undefined },
}

export const FailedToStart: Story = {
  args: {
    error: "The tournament could not be started. Try again.",
    onSubmit: () => undefined,
  },
}
