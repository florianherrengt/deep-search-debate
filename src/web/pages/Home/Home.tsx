import Stack from "@mui/material/Stack"
import { BenefitsSection } from "./components/BenefitsSection.tsx"
import { DebatePromptSection } from "./components/DebatePromptSection.tsx"
import { HeroSection } from "./components/HeroSection.tsx"
import { ProcessSection } from "./components/ProcessSection.tsx"

export function Home() {
  return (
    <Stack spacing={{ xs: 10, md: 14 }} sx={{ pb: { xs: 10, md: 14 } }}>
      <HeroSection />
      <BenefitsSection />
      <ProcessSection />
      <DebatePromptSection />
    </Stack>
  )
}
