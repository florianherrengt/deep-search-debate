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
  "streaming-query-summary":
    "The search results consistently recommend stable, flexible longboards for beginners. The explored sources add",
  "completed-query-summary":
    "The search results favour drop-through longboards with medium-flex decks for beginner cruising. Explored sources consistently highlight stability and predictable turning, while the remaining listings suggest comparing rider weight limits and wheel hardness before buying.",
  "final-answer":
    "OpenAI's current portfolio centres on ChatGPT, its API platform, and enterprise offerings. The research traces the company from its 2015 founding while identifying recurring governance, accountability, and market-concentration criticisms.",
  "streaming-summary":
    "The page describes ChatGPT, the API platform, and enterprise products. It emphasises",
  "completed-summary":
    "The page is a primary source for OpenAI's current product portfolio. It describes ChatGPT offerings for individuals and organisations alongside an API platform for developers.",
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
  "streaming-summary":
    "I am extracting the product claims that answer the research request.",
  "completed-summary":
    "The page is a primary source, so I will prioritize its product descriptions.",
}

const streamingIds = new Set([
  "summary-products-streaming",
  "streaming-query-summary",
  "streaming-summary",
])

const streamErrors: Record<string, string> = {
  "failed-query-summary": "Query summary generation failed",
}

export const researchRequest =
  "Research OpenAI's current products, history, and major criticisms."

export const completedRun: DeepSearchRunState = {
  status: "completed",
  queryGenerations: [],
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
