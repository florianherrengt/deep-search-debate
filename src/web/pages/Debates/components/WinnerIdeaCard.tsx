import { EmojiEventsRounded } from "@mui/icons-material"
import { Card, CardContent, Chip, Stack, Typography } from "@mui/material"
import { alpha } from "@mui/material/styles"
import type { DebateIdea } from "../debateUiTypes.ts"

export function WinnerIdeaCard({ idea }: { idea: DebateIdea }) {
  return (
    <Card
      variant="outlined"
      sx={(theme) => ({
        background: `linear-gradient(135deg, ${alpha(theme.palette.success.main, 0.15)}, ${alpha(theme.palette.primary.main, 0.08)})`,
        borderColor: alpha(theme.palette.success.main, 0.45),
      })}
    >
      <CardContent>
        <Stack
          direction={{ xs: "column", sm: "row" }}
          spacing={2}
          sx={{ alignItems: { sm: "flex-start" } }}
        >
          <EmojiEventsRounded color="success" sx={{ fontSize: 46 }} />
          <Stack spacing={1} sx={{ flexGrow: 1 }}>
            <Chip
              color="success"
              label="Winning idea"
              size="small"
              sx={{ alignSelf: "flex-start" }}
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
