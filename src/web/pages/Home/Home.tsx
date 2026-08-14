import Stack from "@mui/material/Stack"
import { useSeo } from "../../lib/seo.ts"
import { BenefitsSection } from "./components/BenefitsSection.tsx"
import { DebatePromptSection } from "./components/DebatePromptSection.tsx"
import { HeroSection } from "./components/HeroSection.tsx"
import { ProcessSection } from "./components/ProcessSection.tsx"

const homeDescription =
  "Give AI agents a problem. They generate multiple researched ideas and debate them through multiple rounds until one winner remains."

export function Home({ authenticated = false }: { authenticated?: boolean }) {
  useSeo({
    title: "RethinkLoop — AI idea tournaments",
    description: homeDescription,
    path: "/",
  })

  return (
    <Stack
      spacing={authenticated ? { xs: 8, md: 10 } : { xs: 10, md: 14 }}
      sx={{ pb: authenticated ? { xs: 7, md: 9 } : { xs: 10, md: 14 } }}
    >
      <HeroSection compact={authenticated} />
      {authenticated ? null : <BenefitsSection />}
      <ProcessSection />
      <DebatePromptSection authenticated={authenticated} />
    </Stack>
  )
}
