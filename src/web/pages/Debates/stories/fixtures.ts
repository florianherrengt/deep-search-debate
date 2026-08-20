/** Realistic, deterministic data used only by Debate Storybook stories. */
import type {
  DebateIdea,
  DebateMatch,
  DebateRound,
  DebateStanding,
  DebateTournament,
  DebateTranscriptMessage,
} from "../debateUiTypes.ts"

const debatePrompt =
  "Create a product that helps independent cafés reduce food waste without adding more work for staff."

const debateIdeas: DebateIdea[] = [
  {
    ideaId: "idea-prep-forecast",
    position: 0,
    title: "Prep Forecast",
    description:
      "A morning forecast that combines weather, local events, and recent till data into recommended prep quantities.",
  },
  {
    ideaId: "idea-closing-loop",
    position: 1,
    title: "Closing Loop",
    description:
      "A two-minute closing workflow that learns from unsold items without requiring manual inventory counts.",
  },
  {
    ideaId: "idea-dynamic-bake",
    position: 2,
    title: "Dynamic Bake Plan",
    description:
      "A live bake schedule that adjusts the next batch when demand changes during the day.",
  },
  {
    ideaId: "idea-waste-menu",
    position: 3,
    title: "Waste-to-Menu",
    description:
      "A recipe assistant that turns likely surplus ingredients into safe, margin-aware specials.",
  },
  {
    ideaId: "idea-last-hour",
    position: 4,
    title: "Last-Hour Bundles",
    description:
      "A one-tap tool that packages likely leftovers into timed offers near closing.",
  },
  {
    ideaId: "idea-shelf-sense",
    position: 5,
    title: "Shelf Sense",
    description:
      "A camera-assisted shelf check that estimates remaining stock between till reconciliations.",
  },
  {
    ideaId: "idea-neighbour-swap",
    position: 6,
    title: "Neighbour Swap",
    description:
      "A local exchange for cafés to trade sealed ingredients before they expire.",
  },
  {
    ideaId: "idea-menu-trim",
    position: 7,
    title: "Menu Trim",
    description:
      "A weekly report identifying low-volume menu items that create disproportionate ingredient waste.",
  },
  {
    ideaId: "idea-smart-par",
    position: 8,
    title: "Smart Par Sheets",
    description:
      "Self-updating par sheets embedded in the spreadsheets teams already use.",
  },
  {
    ideaId: "idea-supplier-flex",
    position: 9,
    title: "Supplier Flex",
    description:
      "A consolidated ordering layer that helps small cafés buy perishables in smaller quantities.",
  },
  {
    ideaId: "idea-waste-coach",
    position: 10,
    title: "Shift Waste Coach",
    description:
      "Short, contextual prompts that teach staff where waste is occurring during a shift.",
  },
  {
    ideaId: "idea-donation-desk",
    position: 11,
    title: "Donation Desk",
    description:
      "A closing-time pickup coordinator for local charities with automated food-safety records.",
  },
]

const standingOrder = [0, 1, 2, 3, 4, 7, 5, 8, 6, 10, 9, 11]

function createStandings(swissComplete: boolean): DebateStanding[] {
  const wins = swissComplete
    ? [5, 4, 4, 3, 3, 3, 2, 2, 2, 1, 1, 0]
    : [2, 2, 2, 2, 1, 1, 1, 1, 1, 0, 0, 0]
  const elo = swissComplete
    ? [1579, 1561, 1542, 1525, 1514, 1506, 1495, 1487, 1477, 1459, 1441, 1414]
    : [1531, 1528, 1522, 1519, 1510, 1504, 1498, 1496, 1490, 1478, 1466, 1458]

  return standingOrder.map((ideaIndex, rankIndex) => ({
    idea: debateIdeas[ideaIndex],
    wins: wins[rankIndex],
    elo: elo[rankIndex],
  }))
}

function createTranscript(
  matchId: string,
  firstIdea: DebateIdea,
  secondIdea: DebateIdea,
  winner: DebateIdea,
): DebateTranscriptMessage[] {
  const firstWins = winner.ideaId === firstIdea.ideaId
  const start = Date.UTC(2026, 7, 4, 9, 0)
  const texts = [
    `${firstIdea.title} attacks the main source of waste before it happens. It fits the morning decisions staff already make, so adoption does not depend on another end-of-day admin task.`,
    `${secondIdea.title} is more reliable because it learns from observed waste instead of predictions. The workflow is short, measurable, and improves with every close.`,
    `That argument reacts after the value has already been lost. ${firstIdea.title} changes prep quantities while the café can still prevent surplus, and existing till data makes the recommendation immediately useful.`,
    `Forecasts fail when local demand changes suddenly. ${secondIdea.title} captures the café's real operating pattern and gives owners evidence they can use across prep, purchasing, and menu design.`,
    `${winner.title} wins. ${
      firstWins
        ? "It prevents waste at the highest-leverage decision point and asks less of staff during the busiest part of the day."
        : "Its evidence is more dependable, its behaviour change is easier to verify, and it creates a stronger learning loop."
    }`,
  ]

  return texts.map((text, index) => ({
    debateMessageId: `${matchId}-message-${index}`,
    llmGenerationId: `${matchId}-generation-${index}`,
    position: index,
    speakerSlot: index === 4 ? 2 : ((index % 2) as 0 | 1),
    text,
    createdAt: new Date(start + index * 60_000),
  }))
}

function createRunningTranscript(
  matchId: string,
  firstIdea: DebateIdea,
  secondIdea: DebateIdea,
): DebateTranscriptMessage[] {
  return createTranscript(matchId, firstIdea, secondIdea, firstIdea)
    .slice(0, 4)
    .map((message, index, messages) =>
      index === messages.length - 1
        ? {
            ...message,
            text: `${secondIdea.title} does not ask owners to trust a black-box demand forecast. It builds a record from the café's own closing routine and`,
          }
        : message,
    )
}

function roundRobinPairs(roundNumber: number): [number, number][] {
  const participants = debateIdeas.map((_, index) => index)
  for (let rotation = 1; rotation < roundNumber; rotation += 1) {
    participants.splice(1, 0, participants.pop()!)
  }
  return Array.from({ length: participants.length / 2 }, (_, index) => [
    participants[index],
    participants[participants.length - 1 - index],
  ])
}

function createSwissRound(
  roundNumber: number,
  mode: "completed" | "running",
): DebateRound {
  const matches = roundRobinPairs(roundNumber).map(
    ([firstIndex, secondIndex], position): DebateMatch => {
      const firstIdea = debateIdeas[firstIndex]
      const secondIdea = debateIdeas[secondIndex]
      const matchId = `swiss-${roundNumber}-${position}`
      const isRunningMatch = mode === "running" && position === 2
      const isPendingMatch = mode === "running" && position > 2
      const winner = (roundNumber + position) % 2 === 0 ? firstIdea : secondIdea

      return {
        debateMatchId: matchId,
        position,
        firstIdea,
        secondIdea,
        winnerIdeaId: isRunningMatch || isPendingMatch ? null : winner.ideaId,
        status: isRunningMatch
          ? "running"
          : isPendingMatch
            ? "pending"
            : "completed",
        messages: isRunningMatch
          ? createRunningTranscript(matchId, firstIdea, secondIdea)
          : isPendingMatch
            ? []
            : createTranscript(matchId, firstIdea, secondIdea, winner),
      }
    },
  )

  return {
    debateRoundId: `swiss-round-${roundNumber}`,
    stage: "swiss",
    stageRoundNumber: roundNumber,
    matches,
  }
}

function createKnockoutMatch({
  id,
  position,
  firstIdea,
  secondIdea,
  winner,
  status,
}: {
  id: string
  position: number
  firstIdea: DebateIdea
  secondIdea: DebateIdea
  winner?: DebateIdea
  status: DebateMatch["status"]
}): DebateMatch {
  return {
    debateMatchId: id,
    position,
    firstIdea,
    secondIdea,
    winnerIdeaId: winner?.ideaId ?? null,
    status,
    messages:
      status === "running"
        ? createRunningTranscript(id, firstIdea, secondIdea)
        : winner
          ? createTranscript(id, firstIdea, secondIdea, winner)
          : [],
  }
}

const completedSwissRounds = Array.from({ length: 5 }, (_, index) =>
  createSwissRound(index + 1, "completed"),
)

const semifinalOneComplete = createKnockoutMatch({
  id: "semifinal-1",
  position: 0,
  firstIdea: debateIdeas[0],
  secondIdea: debateIdeas[3],
  winner: debateIdeas[0],
  status: "completed",
})
const semifinalTwoRunning = createKnockoutMatch({
  id: "semifinal-2",
  position: 1,
  firstIdea: debateIdeas[1],
  secondIdea: debateIdeas[2],
  status: "running",
})
const semifinalTwoComplete = createKnockoutMatch({
  id: "semifinal-2",
  position: 1,
  firstIdea: debateIdeas[1],
  secondIdea: debateIdeas[2],
  winner: debateIdeas[1],
  status: "completed",
})
const finalComplete = createKnockoutMatch({
  id: "final-1",
  position: 0,
  firstIdea: debateIdeas[0],
  secondIdea: debateIdeas[1],
  winner: debateIdeas[0],
  status: "completed",
})

export const swissTournament: DebateTournament = {
  debateJobId: "debate-swiss",
  ideaJobId: "ideas-swiss",
  title: "Independent Café Energy Ideas",
  slug: "independent-cafe-energy-ideas",
  prompt: debatePrompt,
  isPublic: false,
  isOwner: true,
  stopRequested: false,
  canStop: true,
  stage: "swiss",
  status: "running",
  expectedMatchCount: 33,
  rounds: [
    createSwissRound(1, "completed"),
    createSwissRound(2, "running"),
  ],
  standings: createStandings(false),
  error: null,
  creditsUsed: null,
  feedback: null,
}

export const semifinalTournament: DebateTournament = {
  debateJobId: "debate-semifinal",
  ideaJobId: "ideas-semifinal",
  title: "Independent Café Energy Ideas",
  slug: "independent-cafe-energy-ideas",
  prompt: debatePrompt,
  isPublic: false,
  isOwner: true,
  stopRequested: false,
  canStop: true,
  stage: "semifinal",
  status: "running",
  expectedMatchCount: 33,
  rounds: [
    ...completedSwissRounds,
    {
      debateRoundId: "semifinal-round",
      stage: "semifinal",
      stageRoundNumber: 1,
      matches: [semifinalOneComplete, semifinalTwoRunning],
    },
  ],
  standings: createStandings(true),
  error: null,
  creditsUsed: null,
  feedback: null,
}

export const completedTournament: DebateTournament = {
  debateJobId: "debate-completed",
  ideaJobId: "ideas-completed",
  title: "Independent Café Energy Ideas",
  slug: "independent-cafe-energy-ideas",
  prompt: debatePrompt,
  isPublic: true,
  isOwner: true,
  stopRequested: false,
  canStop: false,
  stage: "final",
  status: "completed",
  expectedMatchCount: 33,
  rounds: [
    ...completedSwissRounds,
    {
      debateRoundId: "semifinal-round",
      stage: "semifinal",
      stageRoundNumber: 1,
      matches: [semifinalOneComplete, semifinalTwoComplete],
    },
    {
      debateRoundId: "final-round",
      stage: "final",
      stageRoundNumber: 1,
      matches: [finalComplete],
    },
  ],
  standings: createStandings(true),
  error: null,
  creditsUsed: 1_234,
  feedback: { rating: null, hasWrittenFeedback: false },
}

export const streamingMatch = swissTournament.rounds[1].matches[2]
export const completedMatch = finalComplete
