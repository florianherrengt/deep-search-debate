import { useEffect, useState, type SyntheticEvent } from "react"
import Alert from "@mui/material/Alert"
import Box from "@mui/material/Box"
import Button from "@mui/material/Button"
import CircularProgress from "@mui/material/CircularProgress"
import ListSubheader from "@mui/material/ListSubheader"
import MenuItem from "@mui/material/MenuItem"
import Paper from "@mui/material/Paper"
import Stack from "@mui/material/Stack"
import TextField from "@mui/material/TextField"
import Typography from "@mui/material/Typography"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { useLocation } from "react-router-dom"

import { RequestError } from "../../components/RequestError.tsx"
import {
  getLlmModelSettings,
  llmModelSettingsQueryKey,
  updateLlmModelSettings,
  type LlmModelSettings,
  type ModelAssignment,
  type ReasoningEffort,
} from "../../lib/llmModelSettings.ts"

type ModelOption = LlmModelSettings["models"][number]
type ModelRole = "small" | "big"
type Assignments = { small: ModelAssignment; big: ModelAssignment } | null
type DraftAssignments = Partial<NonNullable<Assignments>>

export type LlmModelSettingsServices = {
  getSettings: (signal?: AbortSignal) => Promise<LlmModelSettings>
  updateSettings: (assignments: { small: ModelAssignment; big: ModelAssignment }) => Promise<LlmModelSettings>
}

const defaultServices: LlmModelSettingsServices = {
  getSettings: getLlmModelSettings,
  updateSettings: updateLlmModelSettings,
}

const roleDetails: Record<ModelRole, { title: string; description: string }> = {
  small: { title: "Small", description: "Used for summaries, filtering, and titles." },
  big: { title: "Big", description: "Used for planning, synthesis, ideas, and debates." },
}

const reasoningLabels: Record<ReasoningEffort, string> = {
  none: "None",
  minimal: "Minimal",
  low: "Low",
  medium: "Medium",
  high: "High",
  xhigh: "Extra high",
  max: "Maximum",
  ultra: "Ultra",
}

function modelValue(model: Pick<ModelAssignment, "provider" | "modelId">) {
  return `${model.provider}:${model.modelId}`
}

function sameAssignment(left: ModelAssignment, right: ModelAssignment) {
  return left.provider === right.provider && left.modelId === right.modelId && left.reasoningEffort === right.reasoningEffort
}

function findModel(models: ModelOption[], assignment: Pick<ModelAssignment, "provider" | "modelId">) {
  return models.find((model) => model.provider === assignment.provider && model.modelId === assignment.modelId)
}

function assignmentKey(assignments: Assignments) {
  if (!assignments) return "unset"
  return `${modelValue(assignments.small)}:${assignments.small.reasoningEffort}:${modelValue(assignments.big)}:${assignments.big.reasoningEffort}`
}

function ModelAssignmentFields({
  assignment,
  models,
  onChange,
  role,
}: {
  assignment?: ModelAssignment
  models: ModelOption[]
  onChange: (assignment: ModelAssignment) => void
  role: ModelRole
}) {
  const selectedModel = assignment ? findModel(models, assignment) : undefined
  const selectedEfforts = selectedModel?.reasoningEfforts ?? (assignment ? [assignment.reasoningEffort] : [])
  const effortIsAvailable = assignment !== undefined && selectedEfforts.includes(assignment.reasoningEffort)

  function selectModel(value: string) {
    const model = models.find((candidate) => modelValue(candidate) === value)
    if (!model) return
    onChange({
      provider: model.provider,
      modelId: model.modelId,
      reasoningEffort: assignment && model.reasoningEfforts.includes(assignment.reasoningEffort)
        ? assignment.reasoningEffort
        : model.reasoningEfforts[0],
    })
  }

  return (
    <Stack spacing={1.5}>
      <Box>
        <Typography component="h3" variant="subtitle1">{roleDetails[role].title}</Typography>
        <Typography color="text.secondary" variant="body2">{roleDetails[role].description}</Typography>
      </Box>
      {assignment && (!selectedModel || !effortIsAvailable) ? (
        <Alert severity="warning">
          Your current {roleDetails[role].title.toLowerCase()} model choice is unavailable. Choose an available model and reasoning level before saving.
        </Alert>
      ) : null}
      <Stack direction={{ xs: "column", sm: "row" }} spacing={2}>
        <TextField
          error={Boolean(assignment && !selectedModel)}
          fullWidth
          helperText={selectedModel?.description ?? (assignment ? "This saved model is not currently available." : "Choose a model.")}
          label={`${roleDetails[role].title} model`}
          onChange={(event) => selectModel(event.target.value)}
          select
          value={assignment ? modelValue(assignment) : ""}
        >
          <MenuItem value=""><em>Select a model</em></MenuItem>
          {assignment && !selectedModel ? (
            <MenuItem disabled value={modelValue(assignment)}>
              {assignment.modelId} — {assignment.provider === "openai" ? "OpenAI" : "DeepSeek"} (Unavailable)
            </MenuItem>
          ) : null}
          {(["openai", "deepseek"] as const).map((provider) => {
            const providerModels = models.filter((model) => model.provider === provider)
            if (providerModels.length === 0) return null
            return [
              <ListSubheader key={`${provider}-header`}>
                {provider === "openai" ? "OpenAI" : "DeepSeek"}
              </ListSubheader>,
              ...providerModels.map((model) => (
                <MenuItem key={modelValue(model)} value={modelValue(model)}>
                  {model.label}
                </MenuItem>
              )),
            ]
          })}
        </TextField>
        <TextField
          disabled={!selectedModel}
          error={Boolean(assignment && selectedModel && !effortIsAvailable)}
          fullWidth
          helperText="How much reasoning the model should use."
          label={`${roleDetails[role].title} reasoning`}
          onChange={(event) => assignment && onChange({ ...assignment, reasoningEffort: event.target.value as ReasoningEffort })}
          select
          value={assignment?.reasoningEffort ?? ""}
        >
          {!effortIsAvailable && assignment ? (
            <MenuItem disabled value={assignment.reasoningEffort}>
              {reasoningLabels[assignment.reasoningEffort]} (Unavailable)
            </MenuItem>
          ) : null}
          {selectedEfforts.map((effort) => (
            <MenuItem key={effort} value={effort}>{reasoningLabels[effort]}</MenuItem>
          ))}
        </TextField>
      </Stack>
    </Stack>
  )
}

function ModelSettingsForm({
  onChange,
  onSaved,
  services,
  settings,
}: {
  onChange: () => void
  onSaved: (settings: LlmModelSettings) => void
  services: LlmModelSettingsServices
  settings: LlmModelSettings
}) {
  const queryClient = useQueryClient()
  const [assignments, setAssignments] = useState<DraftAssignments>(settings.assignments ?? {})
  const update = useMutation({
    mutationFn: services.updateSettings,
    onSuccess: (snapshot) => {
      queryClient.setQueryData(llmModelSettingsQueryKey, snapshot)
      onSaved(snapshot)
    },
  })
  const choicesAreAvailable = (["small", "big"] as const).every((role) => {
    const assignment = assignments[role]
    if (!assignment) return false
    const model = findModel(settings.models, assignment)
    return model?.reasoningEfforts.includes(assignment.reasoningEffort)
  })
  const hasChanges = !settings.assignments || !assignments.small || !assignments.big ||
    !sameAssignment(assignments.small, settings.assignments.small) ||
    !sameAssignment(assignments.big, settings.assignments.big)

  function changeAssignment(role: ModelRole, assignment: ModelAssignment) {
    update.reset()
    onChange()
    setAssignments((current) => ({ ...current, [role]: assignment }))
  }

  function submit(event: SyntheticEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!choicesAreAvailable || !hasChanges || update.isPending || !assignments.small || !assignments.big) return
    update.mutate({ small: assignments.small, big: assignments.big })
  }

  return (
    <Stack component="form" onSubmit={submit} spacing={2.5}>
      {settings.models.length === 0 ? (
        <Alert severity="warning">No models are available right now. Check the provider messages above and refresh the list.</Alert>
      ) : null}
      {!settings.assignments ? (
        <Alert severity="info">Choose a model and reasoning level for both Small and Big before starting any work.</Alert>
      ) : null}
      <ModelAssignmentFields assignment={assignments.small} models={settings.models} onChange={(assignment) => changeAssignment("small", assignment)} role="small" />
      <ModelAssignmentFields assignment={assignments.big} models={settings.models} onChange={(assignment) => changeAssignment("big", assignment)} role="big" />
      {update.error ? <RequestError error={update.error} /> : null}
      <Box>
        <Button disabled={!choicesAreAvailable || !hasChanges || update.isPending} type="submit" variant="contained">
          {update.isPending ? "Saving…" : "Save model choices"}
        </Button>
      </Box>
    </Stack>
  )
}

export function LlmModelSettingsSection({
  services = defaultServices,
}: {
  services?: LlmModelSettingsServices
}) {
  const location = useLocation()
  const [savedAssignmentKey, setSavedAssignmentKey] = useState<string>()
  const settings = useQuery({
    queryKey: llmModelSettingsQueryKey,
    queryFn: ({ signal }) => services.getSettings(signal),
  })
  const shouldOfferRefresh = settings.data !== undefined &&
    (settings.data.models.length === 0 || settings.data.availability.deepseek.status === "unavailable" || settings.data.availability.openai.status === "unavailable")

  useEffect(() => {
    if (location.hash === "#models") {
      document.getElementById("models")?.scrollIntoView({ block: "start" })
    }
  }, [location.hash])

  return (
    <Paper id="models" tabIndex={-1} sx={{ p: { xs: 2, sm: 3 }, scrollMarginTop: 2 }}>
      <Stack spacing={2.5}>
        <Box>
          <Typography component="h2" variant="h6">Models</Typography>
          <Typography color="text.secondary" variant="body2">
            Choose the model and reasoning level RethinkLoop uses for each type of work. Changes apply to the next model call.
          </Typography>
        </Box>
        {settings.isPending ? (
          <Stack aria-label="Loading model choices" direction="row" role="status" spacing={1.5} sx={{ alignItems: "center" }}>
            <CircularProgress size={22} />
            <Typography color="text.secondary">Loading models…</Typography>
          </Stack>
        ) : null}
        {settings.error ? <RequestError error={settings.error} onRetry={() => void settings.refetch()} /> : null}
        {settings.data === undefined ? null : (["openai", "deepseek"] as const).map((provider) => {
          const availability = settings.data.availability[provider]
          if (availability.status === "available") return null
          const label = provider === "openai" ? "OpenAI" : "DeepSeek"
          return (
            <Alert key={provider} severity={availability.status === "disconnected" ? "info" : "warning"}>
              {availability.message ?? (availability.status === "disconnected"
                ? `${label} models become available after you connect your account above.`
                : `${label} models could not be loaded. Refresh the list to try again.`)}
            </Alert>
          )
        })}
        {shouldOfferRefresh ? (
          <Box><Button disabled={settings.isFetching} onClick={() => void settings.refetch()} variant="outlined">
            {settings.isFetching ? "Refreshing…" : "Refresh models"}
          </Button></Box>
        ) : null}
        {settings.data === undefined ? null : (
          <>
            <ModelSettingsForm
              key={assignmentKey(settings.data.assignments)}
              onChange={() => setSavedAssignmentKey(undefined)}
              onSaved={(snapshot) => setSavedAssignmentKey(assignmentKey(snapshot.assignments))}
              services={services}
              settings={settings.data}
            />
            {savedAssignmentKey !== undefined && savedAssignmentKey === assignmentKey(settings.data.assignments) ? (
              <Alert severity="success">Model choices saved.</Alert>
            ) : null}
          </>
        )}
      </Stack>
    </Paper>
  )
}
