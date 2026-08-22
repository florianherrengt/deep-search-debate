import Container from "@mui/material/Container"
import Typography from "@mui/material/Typography"
import type { Meta, StoryObj } from "@storybook/react"
import { ProgressCard } from "./ProgressCard.tsx"

const meta: Meta<typeof ProgressCard> = {
  title: "Pages/Ideas/Progress card",
  component: ProgressCard,
  decorators: [
    (Story) => (
      <Container maxWidth="md" sx={{ py: 4 }}>
        <Story />
      </Container>
    ),
  ],
  args: {
    title: "Plan the research",
    status: "waiting",
    children: (
      <Typography color="text.secondary">
        Research prompts appear here once planning starts.
      </Typography>
    ),
  },
}

export default meta
type Story = StoryObj<typeof ProgressCard>

export const Waiting: Story = {}

export const Running: Story = {
  args: {
    status: "running",
  },
}

export const Completed: Story = {
  args: {
    status: "completed",
  },
}

export const Failed: Story = {
  args: {
    status: "failed",
  },
}

export const NotRun: Story = {
  args: {
    status: "not-run",
  },
}

export const LongContent: Story = {
  args: {
    status: "completed",
    title: "Improve, research, and assess selected ideas",
    children: (
      <Typography color="text.secondary">
        The selected ideas are refined, given supporting research, and assessed
        in parallel. Refined idea research opens the source searches that
        informed each improved concept, while the final evaluation compares the
        candidate on operational fit, differentiation, and evidence strength.
      </Typography>
    ),
  },
}
