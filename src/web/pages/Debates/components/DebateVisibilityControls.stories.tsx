import Container from "@mui/material/Container"
import type { Meta, StoryObj } from "@storybook/react"
import { DebateVisibilityControls } from "./DebateVisibilityControls.tsx"

const meta: Meta<typeof DebateVisibilityControls> = {
  title: "Pages/Debates/Visibility",
  component: DebateVisibilityControls,
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
type Story = StoryObj<typeof DebateVisibilityControls>

const baseArgs = {
  canMakePrivate: true,
  isPending: false,
  onChange: () => undefined,
  shareUrl: "https://rethinkloop.com/debates/3c6cd152-0a60-4e17-b837-21406bb338e1",
}

export const Private: Story = {
  args: { ...baseArgs, isPublic: false },
}

export const Public: Story = {
  args: { ...baseArgs, isPublic: true },
}

export const RunningPublic: Story = {
  args: { ...baseArgs, canMakePrivate: false, isPublic: true },
}

export const UpdateFailed: Story = {
  args: {
    ...baseArgs,
    error: "Visibility could not be updated. Try again.",
    isPublic: false,
  },
}
