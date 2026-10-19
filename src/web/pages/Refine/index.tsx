import ArrowForwardRounded from "@mui/icons-material/ArrowForwardRounded"
import CircularProgress from "@mui/material/CircularProgress"
import Alert from "@mui/material/Alert"
import Box from "@mui/material/Box"
import Button from "@mui/material/Button"
import Checkbox from "@mui/material/Checkbox"
import Divider from "@mui/material/Divider"
import FormControlLabel from "@mui/material/FormControlLabel"
import Link from "@mui/material/Link"
import Paper from "@mui/material/Paper"
import Stack from "@mui/material/Stack"
import TextField from "@mui/material/TextField"
import Typography from "@mui/material/Typography"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { useCallback, useEffect, useRef, useState, type SubmitEvent } from "react"
import { Link as RouterLink, useNavigate, useParams } from "react-router-dom"
import { RequestError } from "../../components/RequestError.tsx"
import { useSeo } from "../../lib/seo.ts"
import {
  createRefineSession,
  getRefineSession,
  getRefineSessions,
  retryRefinePreparation,
  saveRefineDraft,
  startRefineResearch,
  submitRefineAnswers,
  type RefineAnswer,
  type RefineSession,
  type RefineSessionSummary,
} from "./refineSessions.ts"

const refineListKey = ["refine-sessions"] as const
const refineSessionKey = (id: string) => [...refineListKey, "detail", id] as const

function formatDate(value: Date): string {
  return new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" }).format(value)
}

function SessionHistory({ sessions }: { sessions: RefineSessionSummary[] }) {
  if (sessions.length === 0) return null
  return (
    <Stack component="section" aria-labelledby="refine-history-heading" spacing={1.5}>
      <Typography component="h2" id="refine-history-heading" variant="h5">Your Refine sessions</Typography>
      <Paper variant="outlined">
        {sessions.map((session, index) => (
          <Box key={session.id} sx={{ p: 2 }}>
            {index > 0 ? <Divider sx={{ mb: 2 }} /> : null}
            <Stack direction={{ xs: "column", sm: "row" }} spacing={1} sx={{ alignItems: { xs: "flex-start", sm: "center" }, justifyContent: "space-between" }}>
              <Box sx={{ minWidth: 0 }}>
                <Link component={RouterLink} to={`/refine/${encodeURIComponent(session.id)}`} underline="hover">
                  <Typography component="span" sx={{ overflowWrap: "anywhere" }} variant="subtitle1">{session.originalPrompt}</Typography>
                </Link>
                <Typography color="text.secondary" sx={{ display: "block" }} variant="caption">Updated {formatDate(session.updatedAt)}</Typography>
              </Box>
              {session.research ? <Button component={RouterLink} endIcon={<ArrowForwardRounded />} to={`/deep-search/${encodeURIComponent(session.research.slug)}`}>Open research</Button> : null}
            </Stack>
          </Box>
        ))}
      </Paper>
    </Stack>
  )
}

export function Refine() {
  const { sessionId } = useParams()
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const [prompt, setPrompt] = useState("")

  const history = useQuery({ queryKey: refineListKey, queryFn: ({ signal }) => getRefineSessions(signal), enabled: sessionId === undefined })
  const sessionQuery = useQuery({
    queryKey: sessionId === undefined ? [...refineListKey, "detail", "new"] : refineSessionKey(sessionId),
    queryFn: ({ signal }) => getRefineSession(sessionId ?? "", signal),
    enabled: sessionId !== undefined,
    refetchInterval: (query) => query.state.data?.status === "starting" || (query.state.data?.status === "clarifying" && query.state.data.prepState === "preparing") ? 1_500 : false,
  })
  const updateSession = useCallback((session: RefineSession) => {
    queryClient.setQueryData<RefineSession>(refineSessionKey(session.id), (current) =>
      current !== undefined && current.status !== "clarifying" && session.status === "clarifying" ? current : session,
    )
    void queryClient.invalidateQueries({ queryKey: refineListKey })
  }, [queryClient])
  const createMutation = useMutation({ mutationFn: (value: string) => createRefineSession(value) })

  useSeo({ title: "Refine — RethinkLoop", description: "Clarify a research question before starting deep research.", noindex: true })

  async function handleCreate(event: SubmitEvent<HTMLFormElement>) {
    event.preventDefault()
    const value = prompt.trim()
    if (!value || createMutation.isPending) return
    try {
      const session = await createMutation.mutateAsync(value)
      await queryClient.invalidateQueries({ queryKey: refineListKey })
      void navigate(`/refine/${encodeURIComponent(session.id)}`)
    } catch { /* The mutation error is displayed below. */ }
  }

  if (sessionId !== undefined) {
    if (sessionQuery.isPending) return <Stack sx={{ alignItems: "center", py: 5 }}><CircularProgress aria-label="Loading Refine session" /></Stack>
    if (sessionQuery.error) return <RequestError error={sessionQuery.error} onRetry={() => void sessionQuery.refetch()} />
    if (sessionQuery.data) return (
      <RefineSessionView
        key={`${sessionQuery.data.id}:${sessionQuery.data.currentBatchId ?? "preparing"}:${sessionQuery.data.pendingBatchId ?? "done"}`}
        session={sessionQuery.data}
        onSessionChange={updateSession}
      />
    )
  }

  return (
    <Stack spacing={3}>
      <Stack spacing={1}>
        <Typography component="h1" variant="h3">Refine your research question</Typography>
        <Typography color="text.secondary">Share what you want to explore. The agent will search for context and ask questions that help shape the research.</Typography>
      </Stack>
      <Paper component="form" onSubmit={(event) => void handleCreate(event)} sx={{ maxWidth: 760, p: { xs: 2, sm: 3 }, width: "100%" }} variant="outlined">
        <Stack spacing={2}>
          <TextField autoFocus label="What would you like to research?" minRows={3} multiline onChange={(event) => setPrompt(event.target.value)} value={prompt} />
          {createMutation.error ? <RequestError error={createMutation.error} /> : null}
          <Button disabled={!prompt.trim() || createMutation.isPending} loading={createMutation.isPending} sx={{ alignSelf: { xs: "stretch", sm: "flex-start" } }} type="submit" variant="contained">Start refining</Button>
        </Stack>
      </Paper>
      {history.error ? <RequestError error={history.error} onRetry={() => void history.refetch()} /> : null}
      {history.isPending ? <CircularProgress aria-label="Loading Refine history" size={24} /> : history.data ? <SessionHistory sessions={history.data} /> : null}
    </Stack>
  )
}

function answersForQuestions(session: RefineSession): RefineAnswer[] {
  const saved = new Map(session.draftAnswers.map((answer) => [answer.questionId, answer]))
  const batchId = session.currentBatchId ?? session.pendingBatchId
  const batch = session.batches.find((item) => item.id === batchId)
  return (batch?.questions ?? []).map((question) => saved.get(question.id) ?? {
    questionId: question.id,
    selectedCandidateIds: [],
    text: "",
  })
}

function submittedAnswersForResearch(batch: RefineSession["batches"][number]): RefineAnswer[] {
  return (batch.answers ?? []).map(({ questionId, selectedCandidateIds, text }) => ({ questionId, selectedCandidateIds, text }))
}

function AnswerSummary({ answer, candidates }: { answer: RefineAnswer | undefined; candidates: { id: string; label: string }[] }) {
  const selected = candidates.filter((candidate) => answer?.selectedCandidateIds.includes(candidate.id)).map((candidate) => candidate.label)
  const text = answer?.text.trim()
  if (selected.length === 0 && !text) return <Typography color="text.secondary">Unanswered</Typography>
  return <Stack spacing={0.5}>{selected.map((label) => <Typography key={label} variant="body2">• {label}</Typography>)}{text ? <Typography sx={{ overflowWrap: "anywhere" }} variant="body2">{text}</Typography> : null}</Stack>
}

export function RefineSessionView({
  session,
  onSessionChange,
}: {
  session: RefineSession
  onSessionChange: (session: RefineSession) => void
}) {
  const navigate = useNavigate()
  const navigateWhenResearchStartsRef = useRef(false)
  const [draft, setDraft] = useState<RefineAnswer[]>(() => answersForQuestions(session))
  const draftRef = useRef(draft)
  const revisionRef = useRef(0)
  const savedRevisionRef = useRef(0)
  const [revision, setRevision] = useState(0)
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const saveInFlightRef = useRef<Promise<void> | null>(null)
  const persistLatestDraftRef = useRef<() => Promise<void>>(() => Promise.resolve())
  const activeBatchId = session.currentBatchId ?? session.pendingBatchId
  const currentBatch = session.batches.find((batch) => batch.id === activeBatchId)
  const readOnly = session.status !== "clarifying"
  const questionsReady = currentBatch?.status === "ready"
  const prepFailed = session.prepState === "failed" || currentBatch?.status === "failed"
  const saveMutation = useMutation({ mutationFn: (answers: RefineAnswer[]) => saveRefineDraft(session.id, activeBatchId ?? "", answers) })
  const askMutation = useMutation({ mutationFn: (answers: RefineAnswer[]) => submitRefineAnswers(session.id, activeBatchId ?? "", answers) })
  const retryMutation = useMutation({ mutationFn: () => retryRefinePreparation(session.id, activeBatchId ?? "") })
  const researchMutation = useMutation({ mutationFn: (answers: RefineAnswer[]) => startRefineResearch(session.id, activeBatchId ?? "", answers) })
  const activeAction = askMutation.isPending ? "ask" : retryMutation.isPending ? "retry" : researchMutation.isPending ? "research" : null
  const actionError = saveMutation.error ?? askMutation.error ?? retryMutation.error ?? researchMutation.error

  const saveDraftAsync = saveMutation.mutateAsync

  const persistLatestDraft = useCallback(async (): Promise<void> => {
    if (activeBatchId === null || readOnly) return
    if (saveInFlightRef.current !== null) {
      await saveInFlightRef.current
      if (savedRevisionRef.current < revisionRef.current) await persistLatestDraftRef.current()
      return
    }
    if (savedRevisionRef.current >= revisionRef.current) return
    const savingRevision = revisionRef.current
    const savingDraft = draftRef.current
    const saving = saveDraftAsync(savingDraft).then((updated) => {
      savedRevisionRef.current = savingRevision
      if (savingRevision === revisionRef.current) onSessionChange(updated)
    }).finally(() => {
      saveInFlightRef.current = null
    })
    saveInFlightRef.current = saving
    await saving
    if (savedRevisionRef.current < revisionRef.current) await persistLatestDraftRef.current()
  }, [activeBatchId, onSessionChange, readOnly, saveDraftAsync])

  useEffect(() => {
    persistLatestDraftRef.current = persistLatestDraft
  }, [persistLatestDraft])

  useEffect(() => {
    if (!navigateWhenResearchStartsRef.current || session.status !== "research-started" || !session.research) return
    navigateWhenResearchStartsRef.current = false
    void navigate(`/deep-search/${encodeURIComponent(session.research.slug)}`)
  }, [navigate, session.research, session.status])

  useEffect(() => {
    if (revision <= savedRevisionRef.current || readOnly || activeBatchId === null) return
    if (saveTimerRef.current !== null) clearTimeout(saveTimerRef.current)
    saveTimerRef.current = setTimeout(() => {
      void persistLatestDraft().catch(() => undefined)
      saveTimerRef.current = null
    }, 350)
    return () => {
      if (saveTimerRef.current !== null) clearTimeout(saveTimerRef.current)
    }
  }, [activeBatchId, persistLatestDraft, readOnly, revision])

  useEffect(() => () => {
    if (saveTimerRef.current !== null) clearTimeout(saveTimerRef.current)
  }, [])

  function changeAnswer(questionId: string, update: (answer: RefineAnswer) => RefineAnswer) {
    const current = draftRef.current
    const existing = current.find((answer) => answer.questionId === questionId) ?? { questionId, selectedCandidateIds: [], text: "" }
    const next = current.some((answer) => answer.questionId === questionId)
      ? current.map((answer) => answer.questionId === questionId ? update(answer) : answer)
      : [...current, update(existing)]
    draftRef.current = next
    setDraft(next)
    const nextRevision = revisionRef.current + 1
    revisionRef.current = nextRevision
    setRevision(nextRevision)
  }

  async function flushDraft() {
    if (saveTimerRef.current !== null) clearTimeout(saveTimerRef.current)
    saveTimerRef.current = null
    await persistLatestDraft()
  }

  async function askMore() {
    if (activeBatchId === null || !questionsReady || activeAction !== null) return
    try {
      await flushDraft()
      onSessionChange(await askMutation.mutateAsync(draftRef.current))
    } catch { /* The mutation error is displayed below. */ }
  }

  async function retry() {
    if (activeBatchId === null || activeAction !== null) return
    try {
      await flushDraft()
      onSessionChange(await retryMutation.mutateAsync())
    } catch { /* The mutation error is displayed below. */ }
  }

  async function startResearch() {
    if (activeBatchId === null || askMutation.isPending || researchMutation.isPending) return
    try {
      const answers = currentBatch?.status === "submitted" ? submittedAnswersForResearch(currentBatch) : draftRef.current
      if (currentBatch?.status !== "submitted") await flushDraft()
      navigateWhenResearchStartsRef.current = true
      const updated = await researchMutation.mutateAsync(answers)
      onSessionChange(updated)
      if (updated.status === "research-started" && updated.research) {
        navigateWhenResearchStartsRef.current = false
        void navigate(`/deep-search/${encodeURIComponent(updated.research.slug)}`)
      }
    } catch { /* The mutation error is displayed below. */ }
  }

  return (
    <Stack spacing={3}>
      <Stack spacing={1}>
        <Typography component="h1" variant="h3">Refine</Typography>
        <Typography color="text.secondary" sx={{ overflowWrap: "anywhere" }} variant="body1">{session.originalPrompt}</Typography>
      </Stack>

      {session.status === "starting" ? <Alert icon={<CircularProgress size={20} />} severity="info">Research is starting. Your Refine session is read-only.</Alert> : session.status === "research-started" ? <Alert severity="success">Research has started. Your Refine session is read-only.</Alert> : null}
      {session.batches.map((batch, index) => {
        const isCurrent = !readOnly && batch.id === activeBatchId && batch.status === "ready"
        if (batch.status === "preparing" || (batch.status === "failed" && batch.questions.length === 0)) {
          return <Paper key={batch.id} component="section" aria-label={`Question batch ${index + 1}`} sx={{ p: 2.5 }} variant="outlined">
            <Typography component="h2" gutterBottom variant="h5">Questions {index + 1}</Typography>
            {batch.status === "preparing" ? <Stack direction="row" spacing={1.5} sx={{ alignItems: "center" }}><CircularProgress size={20} /><Typography role="status">Preparing questions…</Typography></Stack> : <Typography color="text.secondary">Question preparation failed.</Typography>}
          </Paper>
        }
        if (isCurrent) return <Paper key={batch.id} component="section" aria-labelledby={`batch-${batch.id}-heading`} sx={{ p: { xs: 2, sm: 3 } }} variant="outlined">
          <Typography component="h2" id={`batch-${batch.id}-heading`} gutterBottom variant="h5">Questions {index + 1}</Typography>
          {batch.questions.length === 0 ? <Typography color="text.secondary">No questions were returned in this batch. You can ask for another batch or start the research.</Typography> : <Stack spacing={2.5}>
            {batch.questions.map((question) => {
              const answer = draft.find((item) => item.questionId === question.id) ?? { questionId: question.id, selectedCandidateIds: [], text: "" }
              return <Box key={question.id} component="fieldset" sx={{ border: 0, m: 0, minWidth: 0, p: 0 }}>
                <Typography component="legend" sx={{ mb: 1, fontWeight: 600, width: "100%" }}>{question.prompt}</Typography>
                <Stack spacing={0.25}>
                  {question.candidates.map((candidate) => <FormControlLabel key={candidate.id} control={<Checkbox checked={answer.selectedCandidateIds.includes(candidate.id)} disabled={askMutation.isPending || researchMutation.isPending} onChange={(event) => changeAnswer(question.id, (current) => ({ ...current, selectedCandidateIds: event.target.checked ? [...current.selectedCandidateIds, candidate.id] : current.selectedCandidateIds.filter((id) => id !== candidate.id) }))} />} label={candidate.label} />)}
                </Stack>
                <TextField disabled={askMutation.isPending || researchMutation.isPending} fullWidth label="Add your own context" minRows={2} multiline onChange={(event) => changeAnswer(question.id, (current) => ({ ...current, text: event.target.value }))} slotProps={{ htmlInput: { "aria-label": `Add your own context for: ${question.prompt}` } }} sx={{ mt: 1 }} value={answer.text} />
              </Box>
            })}
          </Stack>}
        </Paper>
        return <Paper key={batch.id} component="section" aria-labelledby={`batch-${batch.id}-heading`} sx={{ p: { xs: 2, sm: 3 } }} variant="outlined">
          <Typography component="h2" id={`batch-${batch.id}-heading`} gutterBottom variant="h5">Questions {index + 1}</Typography>
          {batch.questions.length === 0 ? <Typography color="text.secondary">No questions in this batch.</Typography> : <Stack spacing={2}>
            {batch.questions.map((question) => <Box key={question.id}>
              <Typography component="h3" gutterBottom variant="subtitle1">{question.prompt}</Typography>
              <AnswerSummary answer={batch.answers?.find((answer) => answer.questionId === question.id)} candidates={question.candidates} />
            </Box>)}
          </Stack>}
        </Paper>
      })}

      <Paper component="section" aria-labelledby="automated-research-heading" sx={{ p: { xs: 2, sm: 3 } }} variant="outlined">
        <Typography component="h2" id="automated-research-heading" gutterBottom variant="h5">Automated research</Typography>
        {session.prepSearches.length === 0 ? <Typography color="text.secondary">Preparation searches will appear here.</Typography> : <Stack spacing={1.25}>
          {session.prepSearches.map((search) => <Stack key={search.deepSearchJobId} direction={{ xs: "column", sm: "row" }} spacing={1} sx={{ alignItems: { xs: "flex-start", sm: "center" }, justifyContent: "space-between" }}>
            <Link component={RouterLink} sx={{ overflowWrap: "anywhere" }} to={`/deep-search/${encodeURIComponent(search.slug)}`}>{search.title}</Link>
            <Typography color={search.status === "failed" ? "error.main" : "text.secondary"} variant="body2">{search.status === "running" ? "Running" : search.status === "completed" ? "Completed" : search.status === "failed" ? "Failed" : "Interrupted"}</Typography>
          </Stack>)}
        </Stack>}
      </Paper>

      {readOnly && session.research ? <Button component={RouterLink} endIcon={<ArrowForwardRounded />} size="large" to={`/deep-search/${encodeURIComponent(session.research.slug)}`} variant="contained">Open research</Button> : null}
      {prepFailed && !readOnly ? <Alert action={<Button disabled={activeAction !== null} loading={retryMutation.isPending} onClick={() => void retry()}>{retryMutation.isPending ? "Retrying…" : "Retry question preparation"}</Button>} severity="error">Question preparation failed. Your answers are saved. Retry preparation or start research now.</Alert> : null}
      {actionError ? <RequestError error={actionError} /> : null}
      {!readOnly ? <>
        {session.prepState === "preparing" || currentBatch?.status === "preparing" ? <Alert severity="info">You can start research while questions are being prepared. Starting research will stop preparation.</Alert> : null}
        <Stack direction={{ xs: "column-reverse", sm: "row" }} spacing={1.5} sx={{ justifyContent: "space-between" }}>
          <Button disabled={!questionsReady || activeAction !== null} loading={askMutation.isPending} onClick={() => void askMore()} variant="outlined">Ask more questions</Button>
          <Button disabled={askMutation.isPending || researchMutation.isPending || activeBatchId === null} loading={researchMutation.isPending} onClick={() => void startResearch()} variant="contained">Start research</Button>
        </Stack>
      </> : null}
    </Stack>
  )
}
