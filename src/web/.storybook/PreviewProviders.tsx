import { CssBaseline } from "@mui/material"
import { ThemeProvider } from "@mui/material/styles"
import { QueryClientProvider } from "@tanstack/react-query"
import { type ComponentProps, type ReactNode, useState } from "react"
import { MemoryRouter } from "react-router-dom"
import { createAppQueryClient } from "../lib/queryClient.ts"
import { appTheme } from "../theme.ts"

export function PreviewProviders({
  children,
  initialEntries,
}: {
  children: ReactNode
  initialEntries?: ComponentProps<typeof MemoryRouter>["initialEntries"]
}) {
  const [queryClient] = useState(createAppQueryClient)
  return (
    <MemoryRouter initialEntries={initialEntries}>
      <ThemeProvider theme={appTheme}>
        <CssBaseline />
        <QueryClientProvider client={queryClient}>
          {children}
        </QueryClientProvider>
      </ThemeProvider>
    </MemoryRouter>
  )
}
