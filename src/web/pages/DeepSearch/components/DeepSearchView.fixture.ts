import type { TextStreamEvent } from "../../../lib/textStreams.ts"
import type {
  DeepSearchPageSummary,
  DeepSearchRunState,
} from "../../../lib/deepSearchState.ts"

const queryOne = "OpenAI current product portfolio official sources"
const queryTwo = "OpenAI company history major milestones"
const queryThree = "OpenAI major criticisms safety governance"

const streamText: Record<string, string> = {
  "summary-products-completed":
    "OpenAI's official homepage presents its main consumer and developer products, current research, and company announcements. For this research request, it is the strongest primary source for identifying the organisation's current product portfolio and how OpenAI describes it.",
  "summary-products-streaming":
    "OpenAI groups its current offering around ChatGPT for individuals and teams, an API platform for developers, and enterprise products. The page emphasises",
  "query-summary-products":
    "The search results identify ChatGPT, the API platform, and enterprise offerings as OpenAI's main current product groups.",
  "query-summary-history":
    "The search results trace OpenAI from its 2015 founding announcement through later changes to its mission and structure.",
  "query-summary-criticism":
    "The search results surface recurring criticism around governance, accountability, market concentration, and the evidence behind safety claims.",
  "query-summary-governance-effects":
    "Independent reporting connects the governance changes to specific accountability concerns, while noting that their long-term effects remain contested.",
  "streaming-query-summary":
    "The search results consistently recommend stable, flexible longboards for beginners. The explored sources add",
  "completed-query-summary":
    "The search results favour drop-through longboards with medium-flex decks for beginner cruising. Explored sources consistently highlight stability and predictable turning, while the remaining listings suggest comparing rider weight limits and wheel hardness before buying.",
  "final-answer":
    "OpenAI's current portfolio centres on ChatGPT, its API platform, and enterprise offerings. The research traces the company from its 2015 founding while identifying recurring governance, accountability, and market-concentration criticisms.",
  "candidate-answer-round-1":
    "OpenAI's current portfolio centres on ChatGPT, its API platform, and enterprise offerings. The evidence also traces its 2015 founding and recurring governance and accountability criticism.",
  "candidate-answer-round-2":
    "OpenAI's current portfolio centres on ChatGPT, its API platform, and enterprise offerings. It was founded in 2015 and later changed its organisational structure. Independent reporting links those governance changes to recurring accountability concerns, although their long-term effects remain contested.",
  "streaming-summary":
    "The page describes ChatGPT, the API platform, and enterprise products. It emphasises",
  "completed-summary":
    "The page is a primary source for OpenAI's current product portfolio. It describes ChatGPT offerings for individuals and organisations alongside an API platform for developers.",
  "query-generation-round-1": JSON.stringify([
    queryOne,
    queryTwo,
    queryThree,
  ]),
  "query-generation-round-2": JSON.stringify([
    "OpenAI governance changes accountability independent analysis",
  ]),
}

const streamReasoning: Record<string, string> = {
  "summary-products-completed":
    "I will retain the product categories and discard unrelated announcements.",
  "summary-products-streaming":
    "I am identifying the product groups relevant to the research request.",
  "query-summary-products":
    "I am combining the explored pages with the remaining search descriptions.",
  "streaming-query-summary":
    "I am combining the explored pages with the remaining search descriptions.",
  "completed-query-summary":
    "I will retain the findings that directly answer the user's request.",
  "final-answer":
    "I will synthesize the product, history, and criticism findings into one answer.",
  "candidate-answer-round-1":
    "I will answer each requested angle using the accumulated search summaries.",
  "streaming-summary":
    "I am extracting the product claims that answer the research request.",
  "completed-summary":
    "The page is a primary source, so I will prioritize its product descriptions.",
  "round-review-running":
    "I am checking whether the product, history, and criticism searches leave a specific material evidence gap.",
  "round-review-completed":
    "The three search summaries cover the requested product, history, and criticism angles, so another round would mostly add volume.",
  "round-review-continue":
    "The candidate describes governance criticism but lacks independent evidence connecting the structural changes to accountability outcomes.",
  "round-review-stop":
    "The revised candidate now covers every requested angle and distinguishes established facts from contested governance effects.",
  "round-review-failed":
    "I identified the completed searches but could not persist a valid review decision.",
}

const streamingIds = new Set([
  "summary-products-streaming",
  "streaming-query-summary",
  "streaming-summary",
  "round-review-running",
])

const streamErrors: Record<string, string> = {
  "failed-query-summary": "Query summary generation failed",
  "round-review-failed": "Round review generation failed",
}

export const researchRequest =
  "Research OpenAI's current products, history, and major criticisms."

export const completedRun: DeepSearchRunState = {
  status: "completed",
  queryGenerations: [],
  roundAnswers: [
    {
      round: 0,
      streamId: "candidate-answer-round-1",
    },
  ],
  roundReviews: [],
  finalAnswerStreamId: "final-answer",
  searches: [
    {
      round: 0,
      query: queryOne,
      querySummaryStreamId: "query-summary-products",
      results: [
        {
          title: "OpenAI",
          shortText:
            "Official OpenAI homepage with links to products, research, and company information.",
          link: "https://openai.com/",
          selection: "selected",
        },
        {
          title: "Products | OpenAI",
          shortText:
            "An overview of ChatGPT, the API platform, and products for businesses and developers.",
          link: "https://openai.com/products/",
          selection: "selected",
        },
        {
          title: "OpenAI product roundup",
          shortText:
            "A third-party summary of recent OpenAI product announcements.",
          link: "https://example.com/openai-products",
          selection: "rejected",
        },
      ],
    },
    {
      round: 0,
      query: queryTwo,
      querySummaryStreamId: "query-summary-history",
      results: [
        {
          title: "OpenAI — About",
          shortText:
            "OpenAI's description of its mission, structure, and company background.",
          link: "https://openai.com/about/",
          selection: "selected",
        },
        {
          title: "Introducing OpenAI",
          shortText:
            "The original 2015 announcement outlining the organisation's founding goals.",
          link: "https://openai.com/index/introducing-openai/",
          selection: "selected",
        },
        {
          title: "A brief history of artificial intelligence labs",
          shortText:
            "A general overview that mentions OpenAI alongside other AI laboratories.",
          link: "https://example.com/ai-lab-history",
          selection: "rejected",
        },
      ],
    },
    {
      round: 0,
      query: queryThree,
      querySummaryStreamId: "query-summary-criticism",
      results: [
        {
          title: "OpenAI safety approach",
          shortText:
            "OpenAI's account of its safety practices, evaluations, and deployment process.",
          link: "https://openai.com/safety/",
          selection: "selected",
        },
        {
          title: "Governance of frontier AI companies",
          shortText:
            "Independent analysis of governance tensions and accountability at frontier AI labs.",
          link: "https://example.org/frontier-ai-governance",
          selection: "selected",
        },
        {
          title: "Debates around AI risk and concentration",
          shortText:
            "A critical discussion of safety claims, market power, and transparency.",
          link: "https://example.net/ai-risk-concentration",
          selection: "selected",
        },
      ],
    },
  ],
  error: null,
}

function addPageSummaries(
  run: DeepSearchRunState,
  summaries: Record<string, DeepSearchPageSummary>,
): DeepSearchRunState {
  return {
    ...run,
    searches: run.searches.map((search) => ({
      ...search,
      results: search.results.map((result) => {
        const summary = summaries[result.link]
        if (!summary) return result
        return { ...result, summary }
      }),
    })),
  }
}

export const streamingPageSummariesRun = addPageSummaries(completedRun, {
  "https://openai.com/": {
    status: "stream",
    streamId: "summary-products-completed",
  },
  "https://openai.com/products/": {
    status: "stream",
    streamId: "summary-products-streaming",
  },
})

const queryGeneration = {
  round: 0,
  streamId: "query-generation-round-1",
}

export const reviewingEvidenceRun: DeepSearchRunState = {
  ...completedRun,
  status: "running",
  queryGenerations: [queryGeneration],
  roundReviews: [
    {
      round: 0,
      streamId: "round-review-running",
      status: "running",
    },
  ],
  finalAnswerStreamId: null,
}

export const moreResearchRequestedRun: DeepSearchRunState = {
  ...reviewingEvidenceRun,
  roundReviews: [
    {
      round: 0,
      streamId: "round-review-continue",
      status: "continue",
      reason:
        "The current evidence describes OpenAI's position, but an independent source is still needed to verify how the governance changes affected accountability.",
    },
  ],
}

export const sufficientEvidenceRun: DeepSearchRunState = {
  ...completedRun,
  queryGenerations: [queryGeneration],
  roundReviews: [
    {
      round: 0,
      streamId: "round-review-stop",
      status: "stop",
      reason:
        "The completed searches directly cover the requested products, history, and major criticisms with both primary and independent sources.",
    },
  ],
}

const secondRoundQuery =
  "OpenAI governance changes accountability independent analysis"

export const refinedAnswerRun: DeepSearchRunState = {
  ...completedRun,
  queryGenerations: [
    queryGeneration,
    { round: 1, streamId: "query-generation-round-2" },
  ],
  roundAnswers: [
    { round: 0, streamId: "candidate-answer-round-1" },
    { round: 1, streamId: "candidate-answer-round-2" },
  ],
  roundReviews: [
    {
      round: 0,
      streamId: "round-review-continue",
      status: "continue",
      reason:
        "The current answer needs independent evidence connecting the governance changes to accountability outcomes.",
    },
    {
      round: 1,
      streamId: "round-review-stop",
      status: "stop",
      reason:
        "The revised answer covers the requested products, history, and criticisms with sufficient independent evidence.",
    },
  ],
  finalAnswerStreamId: "candidate-answer-round-2",
  searches: [
    ...completedRun.searches,
    {
      round: 1,
      query: secondRoundQuery,
      querySummaryStreamId: "query-summary-governance-effects",
      results: [
        {
          title: "Independent analysis of OpenAI governance",
          shortText:
            "Analysis of structural changes, oversight, and accountability concerns.",
          link: "https://example.org/openai-governance-analysis",
          selection: "selected",
        },
      ],
    },
  ],
}

export const reviewFailureRun: DeepSearchRunState = {
  ...completedRun,
  queryGenerations: [queryGeneration],
  roundReviews: [
    {
      round: 0,
      status: "error",
      reason:
        "The reviewer did not return a valid decision, so final synthesis used the evidence already collected.",
    },
  ],
}

/** Supplies deterministic completed and still-running streams to Storybook. */
export async function* subscribeToStoryStream(
  id: string,
  signal?: AbortSignal,
): AsyncGenerator<TextStreamEvent> {
  const error = streamErrors[id]
  if (error) {
    yield { type: "error", message: error }
    yield { type: "done" }
    return
  }

  const reasoning = streamReasoning[id]
  if (reasoning) yield { type: "reasoning", text: reasoning }
  yield { type: "text", text: streamText[id] ?? "" }

  if (streamingIds.has(id)) {
    await new Promise<void>((resolve) => {
      if (signal?.aborted) resolve()
      else signal?.addEventListener("abort", () => resolve(), { once: true })
    })
    return
  }

  yield { type: "done" }
}
