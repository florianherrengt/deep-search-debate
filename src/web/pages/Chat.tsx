import { useMutation } from "@tanstack/react-query"
import { Box, Paper, TextField, Typography } from "@mui/material"
import { FormEvent, useState } from "react"

type Message = { role: "user" | "assistant"; content: string }

export function Chat() {
  const [messages, setMessages] = useState<Message[]>([])
  const [input, setInput] = useState("")
  const [streamingText, setStreamingText] = useState("")

  const mutation = useMutation({
    mutationFn: async (prompt: string) => {
      const res = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ prompt }),
      })
      if (!res.ok) throw new Error(`Chat failed: ${res.status}`)
      const reader = res.body!.getReader()
      const decoder = new TextDecoder()
      let text = ""
      while (true) {
        const { done, value } = await reader.read()
        if (done) break
        text += decoder.decode(value, { stream: true })
        setStreamingText(text)
      }
      return text
    },
    onMutate: (prompt) => {
      setMessages((prev) => [...prev, { role: "user", content: prompt }])
    },
    onSuccess: (text) => {
      setMessages((prev) => [...prev, { role: "assistant", content: text }])
      setStreamingText("")
    },
  })

  const handleSubmit = (e: FormEvent) => {
    e.preventDefault()
    if (!input.trim() || mutation.isPending) return
    mutation.mutate(input.trim())
    setInput("")
  }

  return (
    <Box>
      <Typography variant="h4" gutterBottom>
        Chat
      </Typography>

      <Paper
        component="form"
        onSubmit={handleSubmit}
        sx={{ p: 2, mb: 2 }}
      >
        <TextField
          fullWidth
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder="Ask something..."
          disabled={mutation.isPending}
          slotProps={{ htmlInput: { autoFocus: true } }}
        />
      </Paper>

      <Box>
        {messages.map((m, i) => (
          <Paper key={i} sx={{ p: 2, mb: 1 }} variant="outlined">
            <Typography variant="subtitle2" color="text.secondary">
              {m.role === "user" ? "You" : "DeepSeek"}
            </Typography>
            <Typography sx={{ whiteSpace: "pre-wrap" }}>
              {m.content}
            </Typography>
          </Paper>
        ))}

        {streamingText && (
          <Paper sx={{ p: 2, mb: 1 }} variant="outlined">
            <Typography variant="subtitle2" color="text.secondary">
              DeepSeek
            </Typography>
            <Typography sx={{ whiteSpace: "pre-wrap" }}>
              {streamingText}
            </Typography>
          </Paper>
        )}

        {mutation.isPending && !streamingText && (
          <Typography color="text.secondary">Thinking...</Typography>
        )}
      </Box>
    </Box>
  )
}
