import { Container } from "@mui/material"
import type { Meta, StoryObj } from "@storybook/react"
import { useState } from "react"
import { ResultFeedback } from "../../../components/ResultFeedback.tsx"
import type { ResultFeedback as ResultFeedbackState } from "../../../lib/resultFeedback.ts"
import { DebateView } from "./DebateView.tsx"
import {
  completedTournament,
  semifinalTournament,
  swissTournament,
} from "../stories/fixtures.ts"

const meta: Meta<typeof DebateView> = {
  title: "Pages/Debates/Tournament",
  component: DebateView,
  parameters: { layout: "fullscreen" },
  decorators: [
    (Story) => (
      <Container maxWidth="xl" sx={{ py: 4 }}>
        <Story />
      </Container>
    ),
  ],
}

export default meta
type Story = StoryObj<typeof DebateView>

function CompletedFeedbackControl() {
  const [feedback, setFeedback] = useState<ResultFeedbackState>(
    completedTournament.feedback ?? {
      rating: null,
      hasWrittenFeedback: false,
    },
  )

  return (
    <ResultFeedback
      creditsUsed={completedTournament.creditsUsed ?? 0}
      feedback={feedback}
      iconOnly
      onRatingChange={(rating) => {
        setFeedback((current) => ({
          rating,
          hasWrittenFeedback:
            !rating && current.rating === false && current.hasWrittenFeedback,
        }))
        return Promise.resolve()
      }}
      onSubmitText={() => {
        setFeedback((current) => ({
          ...current,
          hasWrittenFeedback: true,
        }))
        return Promise.resolve()
      }}
      pending={false}
    />
  )
}

export const RunningSwiss: Story = {
  args: {
    tournament: swissTournament,
  },
}

export const RunningSemifinal: Story = {
  args: {
    tournament: semifinalTournament,
  },
}

export const Completed: Story = {
  args: {
    feedbackControl: <CompletedFeedbackControl />,
    tournament: completedTournament,
  },
}

export const LongPrompt: Story = {
  args: {
    tournament: {
      ...completedTournament,
      prompt:
        "Should independent cafés replace manual ordering with an AI-driven predictive inventory system that forecasts demand from weather, local events, and recent till data, or keep the current lightweight process that relies on staff judgement and historical spreadsheets?",
    },
  },
}

export const Failed: Story = {
  args: {
    tournament: {
      ...swissTournament,
      status: "failed",
      error: "The judge failed to return a valid winner. The tournament can be retried.",
    },
  },
}

export const Stopping: Story = {
  args: {
    tournament: {
      ...swissTournament,
      stopRequested: true,
      canStop: false,
    },
  },
}

export const Stopped: Story = {
  args: {
    tournament: {
      ...swissTournament,
      status: "interrupted",
      stopRequested: true,
      canStop: false,
      error: "Workflow stopped by user",
    },
  },
}

export const Interrupted: Story = {
  args: {
    tournament: {
      ...swissTournament,
      status: "interrupted",
      stopRequested: false,
      canStop: false,
      error: "Workflow interrupted during restart recovery",
    },
  },
}
