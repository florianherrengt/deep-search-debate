import {
  Box,
  Paper,
  TextField,
  Typography,
  Accordion,
  AccordionSummary,
  AccordionDetails,
} from "@mui/material"
import ExpandMore from "@mui/icons-material/ExpandMore"
import { FormEvent, useState } from "react"
import { useTextStream } from "../hooks/useTextStream.ts"

type Message = {
  id: string
  role: "user" | "assistant"
  content: string
  reasoning?: string
  streamId?: string
}

export function Chat() {
  const [messages, setMessages] = useState<Message[]>([])
  const [input, setInput] = useState("")
  const { text, reasoning, isStreaming, send } = useTextStream()

  const handleSubmit = (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault()
    const prompt = input.trim()
    if (!prompt || isStreaming) return

    setMessages((prev) => [
      ...prev,
      { id: crypto.randomUUID(), role: "user", content: prompt },
    ])
    setInput("")
    void run(prompt)
  }

  const run = async (prompt: string) => {
    const result = await send({ prompt })
    setMessages((prev) => [
      ...prev,
      {
        id: result.streamId ?? crypto.randomUUID(),
        role: "assistant",
        content: result.text,
        reasoning: result.reasoning || undefined,
        streamId: result.streamId ?? undefined,
      },
    ])
  }

  return (
    <Box>
      <Typography variant="h4" gutterBottom>
        Chat
      </Typography>

      <Paper component="form" onSubmit={handleSubmit} sx={{ p: 2, mb: 2 }}>
        <TextField
          fullWidth
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder="Ask something..."
          disabled={isStreaming}
          slotProps={{ htmlInput: { autoFocus: true } }}
        />
      </Paper>

      <Box>
        {messages.map((m) => (
          <Paper key={m.id} sx={{ p: 2, mb: 1 }} variant="outlined">
            <Typography variant="subtitle2" color="text.secondary">
              {m.role === "user" ? "You" : "DeepSeek"}
            </Typography>
            {m.reasoning && (
              <Accordion sx={{ my: 1 }} defaultExpanded>
                <AccordionSummary expandIcon={<ExpandMore />}>
                  <Typography variant="body2" color="text.secondary">
                    Show reasoning
                  </Typography>
                </AccordionSummary>
                <AccordionDetails>
                  <Typography
                    variant="body2"
                    sx={{ whiteSpace: "pre-wrap", color: "text.secondary" }}
                  >
                    {m.reasoning}
                  </Typography>
                </AccordionDetails>
              </Accordion>
            )}
            <Typography sx={{ whiteSpace: "pre-wrap" }}>
              {m.content}
            </Typography>
          </Paper>
        ))}

        {isStreaming && (text || reasoning) && (
          <Paper sx={{ p: 2, mb: 1 }} variant="outlined">
            <Typography variant="subtitle2" color="text.secondary">
              DeepSeek
            </Typography>
            {reasoning && (
              <Accordion sx={{ my: 1 }} defaultExpanded>
                <AccordionSummary expandIcon={<ExpandMore />}>
                  <Typography variant="body2" color="text.secondary">
                    Reasoning in progress...
                  </Typography>
                </AccordionSummary>
                <AccordionDetails>
                  <Typography
                    variant="body2"
                    sx={{ whiteSpace: "pre-wrap", color: "text.secondary" }}
                  >
                    {reasoning}
                  </Typography>
                </AccordionDetails>
              </Accordion>
            )}
            {text && (
              <Typography sx={{ whiteSpace: "pre-wrap" }}>{text}</Typography>
            )}
          </Paper>
        )}

        {isStreaming && !text && !reasoning && (
          <Typography color="text.secondary">Thinking...</Typography>
        )}
      </Box>
    </Box>
  )
}
