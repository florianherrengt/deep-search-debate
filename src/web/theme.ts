import { createTheme } from "@mui/material/styles"

export const appTheme = createTheme({
  colorSchemes: { dark: true },
  cssVariables: true,
  components: {
    MuiCssBaseline: {
      styleOverrides: {
        "@media (prefers-reduced-motion: reduce)": {
          // MUI transitions may set inline durations, so the user preference
          // needs enough priority to override every component consistently.
          "*, *::before, *::after": {
            animationDuration: "0.01ms !important",
            animationIterationCount: "1 !important",
            scrollBehavior: "auto !important",
            transitionDuration: "0.01ms !important",
          },
        },
      },
    },
  },
})
