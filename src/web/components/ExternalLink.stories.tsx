import Typography from "@mui/material/Typography"
import type { Meta, StoryObj } from "@storybook/react"
import { ExternalLink } from "./ExternalLink.tsx"

const meta = {
  title: "Components/External Link",
  component: ExternalLink,
} satisfies Meta<typeof ExternalLink>

export default meta
type Story = StoryObj<typeof meta>

export const External: Story = {
  args: {
    children: "Search evidence on time-of-use pricing",
    href: "https://example.com/time-of-use-pricing",
  },
}

export const InternalRoute: Story = {
  args: {
    children: "Open the improved idea",
    to: "/ideas/renter-energy-product-ideas/idea-42#improved-idea",
  },
}

export const ButtonVariant: Story = {
  args: {
    children: "Open the improved idea",
    size: "small",
    to: "/ideas/renter-energy-product-ideas/idea-42#improved-idea",
    variant: "button",
  },
}

export const InheritColorInHeading: Story = {
  args: {
    children:
      "A winning idea title long enough to show wrapping keeps the icon beside the last word",
    color: "inherit",
    to: "/ideas/renter-energy-product-ideas/idea-42#improved-idea",
  },
  decorators: [
    (Story) => (
      <Typography component="h2" variant="h5">
        <Story />
      </Typography>
    ),
  ],
}
