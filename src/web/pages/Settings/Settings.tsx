import Stack from "@mui/material/Stack"
import Typography from "@mui/material/Typography"

import { useSeo } from "../../lib/seo.ts"
import { OpenAiConnectionSection } from "./OpenAiConnectionSection.tsx"

export function Settings() {
  useSeo({
    description: "Settings in RethinkLoop. Sign in to access your workspace.",
    noindex: true,
    pageKey: "/settings",
    title: "Settings — RethinkLoop",
  })

  return (
    <Stack spacing={3}>
      <Stack spacing={0.5}>
        <Typography component="h1" variant="h4">
          Settings
        </Typography>
        <Typography color="text.secondary">
          Manage services connected to your RethinkLoop account.
        </Typography>
      </Stack>

      <OpenAiConnectionSection />
    </Stack>
  )
}
