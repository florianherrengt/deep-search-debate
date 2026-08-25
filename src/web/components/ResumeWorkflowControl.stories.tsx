import Container from "@mui/material/Container"
import Stack from "@mui/material/Stack"
import Typography from "@mui/material/Typography"
import type { Meta, StoryObj } from "@storybook/react"

import { ResumeWorkflowControl } from "./ResumeWorkflowControl.tsx"
import { StopWorkflowControl } from "./StopWorkflowControl.tsx"

const meta: Meta<typeof ResumeWorkflowControl> = {
  title: "Components/Workflow controls/Resume",
  component: ResumeWorkflowControl,
  parameters: { layout: "fullscreen" },
  decorators: [
    (Story) => (
      <Container maxWidth="sm" sx={{ py: 4 }}>
        <Stack spacing={2}>
          <Typography variant="h6">Interrupted research</Typography>
          <Stack direction="row" spacing={1} sx={{ alignItems: "center" }}>
            <Story />
            <StopWorkflowControl
              canStop={false}
              pending={false}
              onConfirm={() => undefined}
            />
          </Stack>
        </Stack>
      </Container>
    ),
  ],
}

export default meta
type Story = StoryObj<typeof ResumeWorkflowControl>

export const Available: Story = {
  args: {
    canResume: true,
    pending: false,
    onResume: () => undefined,
  },
}

export const Pending: Story = {
  args: {
    canResume: true,
    pending: true,
    onResume: () => undefined,
  },
}
