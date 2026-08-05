import { EmojiEventsRounded } from "@mui/icons-material"
import { Card, CardContent, Chip, Stack, Typography } from "@mui/material"
import type { DebateIdea } from "../debateUiTypes.ts"

export function WinnerIdeaCard({ idea }: { idea: DebateIdea }) {
  return (
    <Card
      variant="outlined"
      sx={{
        borderColor: "success.dark",
        borderLeftColor: "success.main",
        borderLeftWidth: 3,
      }}
    >
      <CardContent>
        <Stack
          direction={{ xs: "column", sm: "row" }}
          spacing={2}
          sx={{ alignItems: { sm: "flex-start" } }}
        >
          <EmojiEventsRounded color="success" sx={{ fontSize: 34 }} />
          <Stack spacing={1} sx={{ flexGrow: 1 }}>
            <Chip
              color="success"
              label="Winning idea"
              size="small"
              sx={{ alignSelf: "flex-start" }}
              variant="outlined"
            />
            <Typography component="h2" variant="h5">
              {idea.title}
            </Typography>
            <Typography color="text.secondary" variant="body2">
              {idea.description}
            </Typography>
          </Stack>
        </Stack>
      </CardContent>
    </Card>
  )
}
