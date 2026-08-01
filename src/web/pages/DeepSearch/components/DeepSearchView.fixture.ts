import type { TextStreamEvent } from "../../../lib/textStreams.ts"
import type {
  DeepSearchPageSummary,
  DeepSearchRunState,
} from "../deepSearchState.ts"

const queryOne = "OpenAI current product portfolio official sources"
const queryTwo = "OpenAI company history major milestones"
const queryThree = "OpenAI major criticisms safety governance"

const streamText: Record<string, string> = {
  "query-stream-complete": [queryOne, queryTwo, queryThree].join("\n"),
  "selection-stream-products": '["result-0", "result-1"]',
  "selection-stream-history": '["result-1", "result-0"]',
  "selection-stream-criticism": '["result-1", "result-2", "result-0"]',
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
}

const streamReasoning: Record<string, string> = {
  "selection-stream-products":
    "The official product pages are the most direct sources for the current portfolio.",
  "selection-stream-history":
    "The founding announcement and company page provide the strongest chronology.",
  "selection-stream-criticism":
    "Independent governance analysis should be balanced with OpenAI's own safety claims.",
  "summary-products-completed":
    "I will retain the product categories and discard unrelated announcements.",
  "summary-products-streaming":
    "I am identifying the product groups relevant to the research request.",
  "query-summary-products":
    "I am combining the explored pages with the remaining search descriptions.",
}

export const researchRequest =
  "Research OpenAI's current products, history, and major criticisms."

export const completedRun: DeepSearchRunState = {
  status: "completed",
  jobId: "7428de3d-6bea-4e39-862c-2adfe9ebcd36",
  queryStreamId: "query-stream-complete",
  searches: [
    {
      query: queryOne,
      selectionStreamId: "selection-stream-products",
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
      query: queryTwo,
      selectionStreamId: "selection-stream-history",
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
      query: queryThree,
      selectionStreamId: "selection-stream-criticism",
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
  const reasoning = streamReasoning[id]
  if (reasoning) yield { type: "reasoning", text: reasoning }
  yield { type: "text", text: streamText[id] ?? "" }

  if (id === "summary-products-streaming") {
    await new Promise<void>((resolve) => {
      if (signal?.aborted) resolve()
      else signal?.addEventListener("abort", () => resolve(), { once: true })
    })
    return
  }

  yield { type: "done" }
}
