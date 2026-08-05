import { CssBaseline } from "@mui/material"
import { ThemeProvider, createTheme } from "@mui/material/styles"
import type { Preview } from "@storybook/react"
import { MemoryRouter } from "react-router-dom"

const theme = createTheme({
  colorSchemes: { dark: true },
  cssVariables: true,
})

const preview: Preview = {
  decorators: [
    (Story) => (
      <MemoryRouter>
        <ThemeProvider theme={theme}>
          <CssBaseline />
          <Story />
        </ThemeProvider>
      </MemoryRouter>
    ),
  ],
}

export default preview
