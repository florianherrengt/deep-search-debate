import {
  PsychologyRounded,
  RecordVoiceOverRounded,
} from "@mui/icons-material"
import {
  Avatar,
  Box,
  Card,
  CardContent,
  Chip,
  CircularProgress,
  Divider,
  Stack,
  Typography,
} from "@mui/material"
import { alpha } from "@mui/material/styles"
import { FormattedStreamText } from "../../../components/streaming/FormattedStreamText.tsx"
import { useTextStream } from "../../../components/streaming/useTextStream.ts"
import type {
  DebateMatch,
  DebateTranscriptMessage,
} from "../debateUiTypes.ts"

function getSpeakerName(
  message: DebateTranscriptMessage,
  match: DebateMatch,
) {
  if (message.speakerSlot === 0) return match.firstIdea.title
  if (message.speakerSlot === 1) return match.secondIdea.title
  return "Judge"
}

function TranscriptMessage({
  match,
  message,
  streaming,
}: {
  match: DebateMatch
  message: DebateTranscriptMessage
  streaming: boolean
}) {
  const isJudge = message.speakerSlot === 2
  const isSecondSpeaker = message.speakerSlot === 1
  const alignment = isJudge
    ? "center"
    : isSecondSpeaker
      ? "flex-end"
      : "flex-start"
  // Judge streams contain structured JSON. The API exposes only the parsed
  // explanation after judging completes, so raw judge output is never shown.
  const stream = useTextStream(
    streaming && !isJudge && !message.text
      ? message.llmGenerationId
      : null,
  )
  const text = message.text || stream.text

  return (
    <Box
      component="article"
      sx={{
        display: "flex",
        justifyContent: alignment,
        width: "100%",
      }}
    >
      <Stack
        direction={isSecondSpeaker ? "row-reverse" : "row"}
        spacing={1}
        sx={{
          alignItems: "flex-start",
          maxWidth: { xs: "94%", sm: isJudge ? "82%" : "78%" },
          minWidth: 0,
        }}
      >
        <Avatar
          sx={(theme) => ({
            bgcolor: alpha(
              isJudge
                ? theme.palette.warning.main
                : isSecondSpeaker
                  ? theme.palette.secondary.main
                  : theme.palette.primary.main,
              0.18,
            ),
            color: isJudge
              ? "warning.main"
              : isSecondSpeaker
                ? "secondary.main"
                : "primary.main",
            fontSize: "0.75rem",
            fontWeight: 700,
            height: 32,
            width: 32,
          })}
        >
          {isJudge ? "J" : message.speakerSlot === 0 ? "A" : "B"}
        </Avatar>
        <Box
          sx={(theme) => ({
            bgcolor: alpha(
              isJudge
                ? theme.palette.warning.main
                : isSecondSpeaker
                  ? theme.palette.secondary.main
                  : theme.palette.primary.main,
              isJudge ? 0.1 : 0.13,
            ),
            border: 1,
            borderColor: isJudge
              ? "warning.dark"
              : isSecondSpeaker
                ? "secondary.dark"
                : "primary.dark",
            borderRadius: 1,
            borderTopLeftRadius:
              !isJudge && !isSecondSpeaker ? 0.5 : undefined,
            borderTopRightRadius:
              !isJudge && isSecondSpeaker ? 0.5 : undefined,
            boxShadow: 1,
            minWidth: 0,
            px: { xs: 1.25, sm: 1.5 },
            py: 1.25,
          })}
        >
          <Stack
            direction="row"
            spacing={1}
            useFlexGap
            sx={{ alignItems: "center", flexWrap: "wrap", mb: 0.75 }}
          >
            <Typography sx={{ fontWeight: 700 }} variant="caption">
              {getSpeakerName(message, match)}
            </Typography>
            {streaming &&
              (stream.status === "streaming" ||
                stream.status === "reconnecting") && (
              <CircularProgress size={12} />
            )}
            <Typography
              color="text.secondary"
              sx={{ ml: "auto", whiteSpace: "nowrap" }}
              variant="caption"
            >
              {message.createdAt.toLocaleTimeString([], {
                hour: "2-digit",
                minute: "2-digit",
              })}
            </Typography>
          </Stack>
          <FormattedStreamText
            format="markdown"
            testId={`debate-message-${message.debateMessageId}`}
            text={text}
          />
          {(stream.status === "error" || stream.status === "reconnecting") && (
            <Typography
              color={stream.status === "error" ? "error" : "warning.main"}
              variant="caption"
            >
              {stream.message}
            </Typography>
          )}
        </Box>
      </Stack>
    </Box>
  )
}

function TranscriptMessages({
  match,
  live,
}: {
  match: DebateMatch
  live: boolean
}) {
  const messages = [...match.messages].sort(
    (first, second) =>
      first.position - second.position ||
      first.debateMessageId.localeCompare(second.debateMessageId),
  )
  return (
    <Box
      aria-label="Debate messages"
      aria-live="polite"
      role="log"
      sx={(theme) => ({
        backgroundColor: alpha(theme.palette.primary.main, 0.03),
        display: "flex",
        flexDirection: "column",
        gap: { xs: 2, sm: 2.5 },
        overflow: "visible",
        px: { xs: 1.5, sm: 3 },
        py: { xs: 2, sm: 3 },
      })}
    >
      {messages.map((message) => (
        <TranscriptMessage
          key={message.debateMessageId}
          match={match}
          message={message}
          streaming={live && !message.text}
        />
      ))}
    </Box>
  )
}

export function DebateTranscript({
  match,
  live = match.status === "running",
}: {
  match: DebateMatch
  live?: boolean
}) {
  return (
    <Card variant="outlined">
      <CardContent sx={{ pb: 1.5 }}>
        <Stack spacing={1.5}>
          <Stack
            direction="row"
            spacing={1}
            sx={{ alignItems: "center", justifyContent: "space-between" }}
          >
            <Stack direction="row" spacing={1} sx={{ alignItems: "center" }}>
              <RecordVoiceOverRounded color="primary" />
              <Typography component="h2" variant="h6">
                Debate conversation
              </Typography>
            </Stack>
            {live && <Chip color="primary" label="Streaming" size="small" />}
          </Stack>

          <Stack
            direction="row"
            spacing={1}
            useFlexGap
            sx={{ alignItems: "center", flexWrap: "wrap" }}
          >
            <Chip
              color="primary"
              label={`A · ${match.firstIdea.title}`}
              size="small"
              sx={{ maxWidth: "100%" }}
              variant="outlined"
            />
            <Typography color="text.secondary" variant="caption">
              versus
            </Typography>
            <Chip
              color="secondary"
              label={`B · ${match.secondIdea.title}`}
              size="small"
              sx={{ maxWidth: "100%" }}
              variant="outlined"
            />
          </Stack>
        </Stack>
      </CardContent>
      <Divider />
      {match.messages.length > 0 ? (
        <TranscriptMessages live={live} match={match} />
      ) : (
        <Stack
          spacing={1}
          sx={{ alignItems: "center", color: "text.secondary", px: 3, py: 8 }}
        >
          <PsychologyRounded fontSize="large" />
          <Typography variant="body2">This debate has not started yet.</Typography>
        </Stack>
      )}
    </Card>
  )
}
