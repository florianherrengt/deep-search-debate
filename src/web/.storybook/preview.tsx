import type { Preview } from "@storybook/react"
import type { ComponentProps } from "react"
import { MemoryRouter } from "react-router-dom"
import { PreviewProviders } from "./PreviewProviders.tsx"

type RouterParameters = {
  router?: {
    initialEntries?: ComponentProps<typeof MemoryRouter>["initialEntries"]
  }
}

const preview: Preview = {
  decorators: [
    (Story, context) => {
      const { router } = context.parameters as RouterParameters
      return (
        <PreviewProviders initialEntries={router?.initialEntries}>
          <Story />
        </PreviewProviders>
      )
    },
  ],
}

export default preview
