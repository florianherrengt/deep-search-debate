import {
  GavelRounded,
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
import { useEffect, useRef } from "react"
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
  return "Tournament judge"
}

function TranscriptMessage({
  match,
  message,
  streaming,
  onStreamUpdate,
}: {
  match: DebateMatch
  message: DebateTranscriptMessage
  streaming: boolean
  onStreamUpdate: () => void
}) {
  const isJudge = message.speakerSlot === 2
  const isSecondSpeaker = message.speakerSlot === 1
  // Judge streams contain structured JSON. The API exposes only the parsed
  // explanation after judging completes, so raw judge output is never shown.
  const stream = useTextStream(
    streaming && !isJudge && !message.text
      ? message.llmGenerationId
      : null,
  )
  const text = message.text || stream.text

  useEffect(() => {
    if (stream.text) onStreamUpdate()
  }, [onStreamUpdate, stream.text])

  return (
    <Box
      component="article"
      sx={{
        bgcolor: isJudge ? "action.hover" : "transparent",
        borderBottom: 1,
        borderColor: "divider",
        mx: { xs: -1.5, sm: -2.5 },
        px: { xs: 1.5, sm: 2.5 },
        py: 2,
        "&:last-child": { borderBottom: 0 },
      }}
    >
      <Stack
        direction="row"
        spacing={1.5}
        sx={{
          alignItems: "flex-start",
          borderLeft: "2px solid",
          borderLeftColor: isJudge
            ? "warning.main"
            : isSecondSpeaker
              ? "secondary.main"
              : "primary.main",
          pl: 1.5,
        }}
      >
        <Avatar
          variant="rounded"
          sx={(theme) => ({
            bgcolor: isJudge
              ? alpha(theme.palette.warning.main, 0.14)
              : isSecondSpeaker
                ? alpha(theme.palette.secondary.main, 0.14)
                : alpha(theme.palette.primary.main, 0.14),
            color: isJudge
              ? "warning.light"
              : isSecondSpeaker
                ? "secondary.light"
                : "primary.light",
            fontSize: "0.75rem",
            fontWeight: 700,
            height: 28,
            width: 28,
          })}
        >
          {isJudge ? "J" : message.speakerSlot === 0 ? "A" : "B"}
        </Avatar>
        <Box
          sx={{
            flexGrow: 1,
            minWidth: 0,
          }}
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
            {isJudge && (
              <Chip
                icon={<GavelRounded />}
                label="Judge"
                size="small"
                variant="outlined"
              />
            )}
            {streaming &&
              (stream.status === "streaming" ||
                stream.status === "reconnecting") && (
              <CircularProgress size={12} />
            )}
            <Typography
              color="text.secondary"
              sx={{ ml: "auto" }}
              variant="caption"
            >
              {message.createdAt.toLocaleTimeString([], {
                hour: "2-digit",
                minute: "2-digit",
              })}
            </Typography>
          </Stack>
          <Typography
            component="div"
            sx={{
              lineHeight: 1.7,
              maxWidth: "85ch",
              overflowWrap: "anywhere",
              whiteSpace: "pre-wrap",
            }}
            variant="body2"
          >
            {text}
          </Typography>
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
  const viewportRef = useRef<HTMLDivElement>(null)
  const followOutputRef = useRef(true)
  const previousMatchIdRef = useRef(match.debateMatchId)
  const messages = [...match.messages].sort(
    (first, second) =>
      first.position - second.position ||
      first.debateMessageId.localeCompare(second.debateMessageId),
  )
  const latestMessage = messages.at(-1)

  useEffect(() => {
    const viewport = viewportRef.current
    if (!viewport) return

    if (previousMatchIdRef.current !== match.debateMatchId) {
      previousMatchIdRef.current = match.debateMatchId
      followOutputRef.current = true
    }
    if (followOutputRef.current) viewport.scrollTop = viewport.scrollHeight
  }, [match.debateMatchId, latestMessage?.debateMessageId, latestMessage?.text])

  function handleScroll() {
    const viewport = viewportRef.current
    if (!viewport) return

    const distanceFromBottom =
      viewport.scrollHeight - viewport.scrollTop - viewport.clientHeight
    followOutputRef.current = distanceFromBottom <= 48
  }

  function followStreamOutput() {
    const viewport = viewportRef.current
    if (viewport && followOutputRef.current) {
      viewport.scrollTop = viewport.scrollHeight
    }
  }

  return (
    <Box
      ref={viewportRef}
      aria-label="Debate messages"
      aria-live="polite"
      onScroll={handleScroll}
      role="log"
      sx={{
        maxHeight: { xs: 520, lg: "calc(100vh - 290px)" },
        minHeight: 360,
        overflowY: "auto",
        px: { xs: 1.5, sm: 2.5 },
      }}
    >
      {messages.map((message) => (
        <TranscriptMessage
          key={message.debateMessageId}
          match={match}
          message={message}
          onStreamUpdate={followStreamOutput}
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
                Debate transcript
              </Typography>
            </Stack>
            <Chip
              color={live ? "primary" : "default"}
              label={live ? "Streaming" : "Transcript"}
              size="small"
              variant={live ? "filled" : "outlined"}
            />
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
