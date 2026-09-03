import { useState, type SyntheticEvent } from "react"
import Alert from "@mui/material/Alert"
import Box from "@mui/material/Box"
import Button from "@mui/material/Button"
import CircularProgress from "@mui/material/CircularProgress"
import MenuItem from "@mui/material/MenuItem"
import Paper from "@mui/material/Paper"
import Stack from "@mui/material/Stack"
import TextField from "@mui/material/TextField"
import Typography from "@mui/material/Typography"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"

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

export type LlmModelSettingsServices = {
  getSettings: (signal?: AbortSignal) => Promise<LlmModelSettings>
  updateSettings: (assignments: {
    small: ModelAssignment
    big: ModelAssignment
  }) => Promise<LlmModelSettings>
}

const defaultServices: LlmModelSettingsServices = {
  getSettings: getLlmModelSettings,
  updateSettings: updateLlmModelSettings,
}

const roleDetails: Record<
  ModelRole,
  { title: string; description: string }
> = {
  small: {
    title: "Small",
    description: "Used for summaries, filtering, and titles.",
  },
  big: {
    title: "Big",
    description: "Used for planning, synthesis, ideas, and debates.",
  },
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
  return (
    left.provider === right.provider &&
    left.modelId === right.modelId &&
    left.reasoningEffort === right.reasoningEffort
  )
}

function findModel(
  models: ModelOption[],
  assignment: Pick<ModelAssignment, "provider" | "modelId">,
) {
  return models.find(
    (model) =>
      model.provider === assignment.provider &&
      model.modelId === assignment.modelId,
  )
}

function assignmentKey(settings: LlmModelSettings) {
  return `${modelValue(settings.assignments.small)}:${settings.assignments.small.reasoningEffort}:${modelValue(settings.assignments.big)}:${settings.assignments.big.reasoningEffort}`
}

function ModelAssignmentFields({
  assignment,
  models,
  onChange,
  recommendation,
  role,
}: {
  assignment: ModelAssignment
  models: ModelOption[]
  onChange: (assignment: ModelAssignment) => void
  recommendation: ModelAssignment
  role: ModelRole
}) {
  const selectedModel = findModel(models, assignment)
  const selectedModelValue = modelValue(assignment)
  const selectedEfforts = selectedModel?.reasoningEfforts ?? [
    assignment.reasoningEffort,
  ]
  const effortIsAvailable = selectedEfforts.includes(
    assignment.reasoningEffort,
  )
  const currentChoiceIsAvailable = selectedModel !== undefined

  function selectModel(value: string) {
    const model = models.find((candidate) => modelValue(candidate) === value)
    if (!model) return

    const recommendationMatches =
      model.provider === recommendation.provider &&
      model.modelId === recommendation.modelId
    const nextEffort = model.reasoningEfforts.includes(
      assignment.reasoningEffort,
    )
      ? assignment.reasoningEffort
      : recommendationMatches &&
          model.reasoningEfforts.includes(recommendation.reasoningEffort)
        ? recommendation.reasoningEffort
        : model.reasoningEfforts[0]

    onChange({
      provider: model.provider,
      modelId: model.modelId,
      reasoningEffort: nextEffort,
    })
  }

  return (
    <Stack spacing={1.5}>
      <Box>
        <Typography component="h3" variant="subtitle1">
          {roleDetails[role].title}
        </Typography>
        <Typography color="text.secondary" variant="body2">
          {roleDetails[role].description}
        </Typography>
      </Box>

      {!currentChoiceIsAvailable || !effortIsAvailable ? (
        <Alert severity="warning">
          Your current {roleDetails[role].title.toLowerCase()} model choice is
          unavailable. Choose an available model and reasoning level before
          saving.
        </Alert>
      ) : null}

      <Stack direction={{ xs: "column", sm: "row" }} spacing={2}>
        <TextField
          error={!currentChoiceIsAvailable}
          fullWidth
          helperText={
            selectedModel?.description ??
            (currentChoiceIsAvailable
              ? selectedModel?.providerLabel
              : "This saved model is not currently available.")
          }
          label={`${roleDetails[role].title} model`}
          onChange={(event) => selectModel(event.target.value)}
          select
          value={selectedModelValue}
        >
          {!currentChoiceIsAvailable ? (
            <MenuItem disabled value={selectedModelValue}>
              {assignment.modelId} —{" "}
              {assignment.provider === "openai" ? "OpenAI" : "DeepSeek"}
              {" (Unavailable)"}
            </MenuItem>
          ) : null}
          {models.map((model) => {
            const isRecommended =
              model.provider === recommendation.provider &&
              model.modelId === recommendation.modelId
            return (
              <MenuItem key={modelValue(model)} value={modelValue(model)}>
                {model.label} — {model.providerLabel}
                {isRecommended ? " (Recommended)" : ""}
              </MenuItem>
            )
          })}
        </TextField>

        <TextField
          disabled={!currentChoiceIsAvailable}
          error={currentChoiceIsAvailable && !effortIsAvailable}
          fullWidth
          helperText="How much reasoning the model should use."
          label={`${roleDetails[role].title} reasoning`}
          onChange={(event) =>
            onChange({
              ...assignment,
              reasoningEffort: event.target.value as ReasoningEffort,
            })
          }
          select
          value={assignment.reasoningEffort}
        >
          {!effortIsAvailable ? (
            <MenuItem disabled value={assignment.reasoningEffort}>
              {reasoningLabels[assignment.reasoningEffort]} (Unavailable)
            </MenuItem>
          ) : null}
          {selectedEfforts.map((effort) => (
            <MenuItem key={effort} value={effort}>
              {reasoningLabels[effort]}
              {effort === recommendation.reasoningEffort &&
              assignment.provider === recommendation.provider &&
              assignment.modelId === recommendation.modelId
                ? " (Recommended)"
                : ""}
            </MenuItem>
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
  const [assignments, setAssignments] = useState(settings.assignments)
  const update = useMutation({
    mutationFn: services.updateSettings,
    onSuccess: (snapshot) => {
      queryClient.setQueryData(llmModelSettingsQueryKey, snapshot)
      onSaved(snapshot)
    },
  })

  const choicesAreAvailable = (["small", "big"] as const).every((role) => {
    const model = findModel(settings.models, assignments[role])
    return model?.reasoningEfforts.includes(
      assignments[role].reasoningEffort,
    )
  })
  const hasChanges =
    !sameAssignment(assignments.small, settings.assignments.small) ||
    !sameAssignment(assignments.big, settings.assignments.big)

  function changeAssignment(role: ModelRole, assignment: ModelAssignment) {
    update.reset()
    onChange()
    setAssignments((current) => ({ ...current, [role]: assignment }))
  }

  function submit(event: SyntheticEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!choicesAreAvailable || !hasChanges || update.isPending) return
    update.mutate(assignments)
  }

  return (
    <Stack component="form" onSubmit={submit} spacing={2.5}>
      {settings.models.length === 0 ? (
        <Alert severity="warning">
          No models are available right now. Check the provider messages above
          and refresh the list.
        </Alert>
      ) : null}

      <ModelAssignmentFields
        assignment={assignments.small}
        models={settings.models}
        onChange={(assignment) => changeAssignment("small", assignment)}
        recommendation={settings.recommendations.small}
        role="small"
      />
      <ModelAssignmentFields
        assignment={assignments.big}
        models={settings.models}
        onChange={(assignment) => changeAssignment("big", assignment)}
        recommendation={settings.recommendations.big}
        role="big"
      />

      {update.error ? <RequestError error={update.error} /> : null}

      <Box>
        <Button
          disabled={!choicesAreAvailable || !hasChanges || update.isPending}
          type="submit"
          variant="contained"
        >
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
  const [savedAssignmentKey, setSavedAssignmentKey] = useState<string>()
  const settings = useQuery({
    queryKey: llmModelSettingsQueryKey,
    queryFn: ({ signal }) => services.getSettings(signal),
  })
  const shouldOfferRefresh =
    settings.data !== undefined &&
    (settings.data.models.length === 0 ||
      settings.data.availability.deepseek.status === "unavailable" ||
      settings.data.availability.openai.status === "unavailable")

  return (
    <Paper sx={{ p: { xs: 2, sm: 3 } }}>
      <Stack spacing={2.5}>
        <Box>
          <Typography component="h2" variant="h6">
            Models
          </Typography>
          <Typography color="text.secondary" variant="body2">
            Choose the model and reasoning level RethinkLoop uses for each type
            of work. Changes apply to the next model call.
          </Typography>
        </Box>

        {settings.isPending ? (
          <Stack
            aria-label="Loading model choices"
            direction="row"
            role="status"
            spacing={1.5}
            sx={{ alignItems: "center" }}
          >
            <CircularProgress size={22} />
            <Typography color="text.secondary">
              Loading models…
            </Typography>
          </Stack>
        ) : null}
        {settings.error ? (
          <RequestError
            error={settings.error}
            onRetry={() => void settings.refetch()}
          />
        ) : null}
        {settings.data === undefined
          ? null
          : (["deepseek", "openai"] as const).map((provider) => {
              const availability = settings.data.availability[provider]
              if (availability.status === "available") return null
              const providerLabel =
                provider === "deepseek" ? "DeepSeek" : "OpenAI"
              return (
                <Alert
                  key={provider}
                  severity={
                    availability.status === "disconnected" ? "info" : "warning"
                  }
                >
                  {availability.message ??
                    (availability.status === "disconnected"
                      ? `${providerLabel} models become available after you connect your account above.`
                      : `${providerLabel} models could not be loaded. Refresh the list to try again.`)}
                </Alert>
              )
            })}
        {shouldOfferRefresh ? (
          <Box>
            <Button
              disabled={settings.isFetching}
              onClick={() => void settings.refetch()}
              variant="outlined"
            >
              {settings.isFetching ? "Refreshing…" : "Refresh models"}
            </Button>
          </Box>
        ) : null}
        {settings.data === undefined ? null : (
          <>
            <ModelSettingsForm
              key={assignmentKey(settings.data)}
              onChange={() => setSavedAssignmentKey(undefined)}
              onSaved={(snapshot) =>
                setSavedAssignmentKey(assignmentKey(snapshot))
              }
              services={services}
              settings={settings.data}
            />
            {savedAssignmentKey === assignmentKey(settings.data) ? (
              <Alert severity="success">Model choices saved.</Alert>
            ) : null}
          </>
        )}
      </Stack>
    </Paper>
  )
}
