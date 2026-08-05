import { CssBaseline } from "@mui/material"
import { ThemeProvider } from "@mui/material/styles"
import type { Preview } from "@storybook/react"
import { MemoryRouter } from "react-router-dom"
import { appTheme } from "../theme.ts"

const preview: Preview = {
  decorators: [
    (Story) => (
      <MemoryRouter>
        <ThemeProvider theme={appTheme}>
          <CssBaseline />
          <Story />
        </ThemeProvider>
      </MemoryRouter>
    ),
  ],
}

export default preview
