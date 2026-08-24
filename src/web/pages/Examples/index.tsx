import Button from "@mui/material/Button"
import Card from "@mui/material/Card"
import CardActions from "@mui/material/CardActions"
import CardContent from "@mui/material/CardContent"
import CircularProgress from "@mui/material/CircularProgress"
import Stack from "@mui/material/Stack"
import Typography from "@mui/material/Typography"
import { useQuery } from "@tanstack/react-query"
import { Link } from "react-router-dom"

import { RequestError } from "../../components/RequestError.tsx"
import { getExampleDebates } from "../../lib/examples.ts"
import { useSeo } from "../../lib/seo.ts"
import { MarkdownText } from "../../components/MarkdownText.tsx"

const exampleDebatesQueryKey = ["example-debates"] as const
const description =
  "Explore selected RethinkLoop examples with researched ideas, multi-round AI debates, and a final winner."

export function Examples() {
  const examples = useQuery({
    queryKey: exampleDebatesQueryKey,
    queryFn: ({ signal }) => getExampleDebates(signal),
  })

  useSeo({
    description,
    pageKey: "/examples",
    path: "/examples",
    title: "Examples — RethinkLoop",
  })

  return (
    <Stack spacing={{ xs: 3, sm: 4 }} sx={{ py: { xs: 4, sm: 6 } }}>
      <Stack spacing={1.5} sx={{ maxWidth: "68ch" }}>
        <Typography component="h1" variant="h3">
          Debate examples
        </Typography>
        <Typography color="text.secondary" component="p" variant="h6">
          Selected public debates showing the complete path from research and
          competing ideas to arguments, judging, and a final winner.
        </Typography>
      </Stack>

      {examples.isPending ? (
        <CircularProgress aria-label="Loading examples" />
      ) : examples.error ? (
        <RequestError
          error={examples.error}
          onRetry={() => void examples.refetch()}
        />
      ) : examples.data.length === 0 ? (
        <Typography color="text.secondary">
          No examples are currently published.
        </Typography>
      ) : (
        <Stack spacing={2}>
          {examples.data.map((debate) => (
            <Card component="article" key={debate.debateJobId} variant="outlined">
              <CardContent>
                <Stack spacing={1}>
                  <Typography component="h2" variant="h5">
                    {debate.title}
                  </Typography>
                  <MarkdownText text={debate.prompt} />
                </Stack>
              </CardContent>
              <CardActions sx={{ px: 2, pb: 2 }}>
                <Button
                  component={Link}
                  to={`/debates/${encodeURIComponent(debate.slug)}`}
                  variant="outlined"
                >
                  View debate
                </Button>
              </CardActions>
            </Card>
          ))}
        </Stack>
      )}
    </Stack>
  )
}
