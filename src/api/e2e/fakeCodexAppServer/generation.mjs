import { randomUUID } from "node:crypto"
import { cwd } from "node:process"

function model() {
  return {
    id: "gpt-e2e-codex",
    model: "gpt-e2e-codex",
    upgrade: null,
    upgradeInfo: null,
    availabilityNux: null,
    displayName: "E2E Codex",
    description: "Deterministic Codex app-server model",
    modelSpecialty: null,
    hidden: false,
    supportedReasoningEfforts: [
      "low",
      "medium",
      "high",
      "xhigh",
      "max",
      "ultra",
    ].map((reasoningEffort) => ({
      reasoningEffort,
      description: reasoningEffort,
    })),
    defaultReasoningEffort: "medium",
    inputModalities: ["text"],
    supportsPersonality: false,
    multiAgentVersion: null,
    additionalSpeedTiers: [],
    serviceTiers: [],
    defaultServiceTier: null,
    isDefault: true,
  }
}

function thread(id, workingDirectory) {
  const now = Math.floor(Date.now() / 1000)
  return {
    id,
    sessionId: id,
    forkedFromId: null,
    parentThreadId: null,
    preview: "",
    ephemeral: true,
    section: null,
    sectionEnteredAt: null,
    projectId: null,
    modelProvider: "openai",
    createdAt: now,
    updatedAt: now,
    recencyAt: now,
    status: { type: "idle" },
    path: null,
    cwd: workingDirectory,
    cliVersion: "0.149.1",
    source: "appServer",
    threadSource: null,
    agentNickname: null,
    agentRole: null,
    gitInfo: null,
    name: null,
    turns: [],
  }
}

function turn(id, status, items = []) {
  const now = Math.floor(Date.now() / 1000)
  return {
    id,
    items,
    itemsView: "full",
    status,
    error: null,
    startedAt: now,
    completedAt: status === "completed" ? now : null,
    durationMs: status === "completed" ? 20 : null,
  }
}

function requestPrompt(params) {
  return (params.input ?? [])
    .filter((value) => value.type === "text" && typeof value.text === "string")
    .map((value) => value.text)
    .join("\n")
}

function requireSchemaProperty(schema, propertyName) {
  if (
    !schema ||
    typeof schema !== "object" ||
    Array.isArray(schema) ||
    schema.type !== "object" ||
    !schema.properties ||
    typeof schema.properties !== "object" ||
    Array.isArray(schema.properties) ||
    !Array.isArray(schema.required) ||
    !schema.required.includes(propertyName)
  ) {
    throw new Error(`invalid ${propertyName} output schema`)
  }
  const property = schema.properties[propertyName]
  if (!property || typeof property !== "object" || Array.isArray(property)) {
    throw new Error(`missing ${propertyName} output schema property`)
  }
  return property
}

function structuredOutput(params, prompt) {
  if (!Object.hasOwn(params, "outputSchema")) return

  const schema = params.outputSchema
  const propertyNames = Object.keys(schema?.properties ?? {})
  if (propertyNames.length !== 1) {
    throw new Error("expected one structured output property")
  }

  if (propertyNames[0] === "title") {
    const title = requireSchemaProperty(schema, "title")
    if (
      title.type !== "string" ||
      title.minLength !== 1 ||
      title.maxLength !== 80
    ) {
      throw new Error("unexpected title output schema")
    }
    return JSON.stringify({ title: "E2E Codex Structured Title" })
  }

  if (propertyNames[0] === "elements") {
    const elements = requireSchemaProperty(schema, "elements")
    if (
      elements.type !== "array" ||
      !elements.items ||
      typeof elements.items !== "object" ||
      elements.items.type !== "string"
    ) {
      throw new Error("unexpected string-array output schema")
    }
    const requestedCount = /Generate exactly (\d+) (?:new )?search queries\./.exec(
      prompt,
    )?.[1]
    if (requestedCount) {
      if (
        elements.items.minLength !== 1 ||
        elements.items.maxLength !== 500
      ) {
        throw new Error("unexpected query-array item schema")
      }
      return JSON.stringify({
        elements: Array.from(
          { length: Number(requestedCount) },
          (_, index) => `E2E Codex structured query ${index + 1}`,
        ),
      })
    }

    const firstSearchResult = /<search_result>\s*({[^<]+})\s*<\/search_result>/.exec(
      prompt,
    )?.[1]
    if (!firstSearchResult) {
      throw new Error("unsupported string-array structured prompt")
    }
    const result = JSON.parse(firstSearchResult)
    if (!result || typeof result.id !== "string") {
      throw new Error("search-result selection prompt omitted an id")
    }
    return JSON.stringify({ elements: [result.id] })
  }

  throw new Error(`unsupported output schema property: ${propertyNames[0]}`)
}

function emitTurn(notify, threadId, turnId, prompt, output) {
  const reasoning =
    "Use the connected ChatGPT subscription without product credits."
  const text =
    output ??
    (prompt.includes("[E2E_CODEX_SUBSCRIPTION]")
      ? "E2E Codex subscription response."
      : "E2E Codex response.")
  const reasoningId = "e2e-reasoning"
  const messageId = "e2e-agent-message"

  notify("turn/started", {
    threadId,
    turn: turn(turnId, "inProgress"),
  })
  notify("item/reasoning/summaryTextDelta", {
    threadId,
    turnId,
    itemId: reasoningId,
    delta: reasoning,
  })
  notify("item/agentMessage/delta", {
    threadId,
    turnId,
    itemId: messageId,
    delta: text,
  })

  const usage = {
    totalTokens: 24,
    inputTokens: 16,
    cachedInputTokens: 0,
    cacheWriteInputTokens: 0,
    outputTokens: 8,
    reasoningOutputTokens: 4,
  }
  notify("thread/tokenUsage/updated", {
    threadId,
    turnId,
    tokenUsage: {
      total: usage,
      last: usage,
      modelContextWindow: 128000,
    },
  })
  notify("turn/completed", {
    threadId,
    turn: turn(turnId, "completed", [
      {
        type: "reasoning",
        id: reasoningId,
        summary: [reasoning],
        content: [],
      },
      {
        type: "agentMessage",
        id: messageId,
        text,
        phase: null,
        memoryCitation: null,
        delivery: null,
      },
    ]),
  })
}

export function createFakeCodexGeneration({
  fail,
  isLoggedIn,
  notify,
  respond,
}) {
  const threadEfforts = new Map()

  return {
    handle(method, id, params) {
      switch (method) {
        case "model/list":
          if (!isLoggedIn()) {
            fail(id, "authentication required", 401)
            return true
          }
          respond(id, { data: [model()], nextCursor: null })
          return true
        case "thread/start": {
          if (!isLoggedIn()) {
            fail(id, "authentication required", 401)
            return true
          }
          const requestedEffort = params.config?.model_reasoning_effort
          const supportedEfforts = model().supportedReasoningEfforts.map(
            ({ reasoningEffort }) => reasoningEffort,
          )
          if (!supportedEfforts.includes(requestedEffort)) {
            fail(id, "expected an advertised reasoning effort", -32602)
            return true
          }
          const threadId = randomUUID()
          threadEfforts.set(threadId, requestedEffort)
          const workingDirectory = params.cwd ?? cwd()
          respond(id, {
            thread: thread(threadId, workingDirectory),
            model: params.model ?? "gpt-e2e-codex",
            modelProvider: "openai",
            serviceTier: null,
            cwd: workingDirectory,
            instructionSources: [],
            approvalPolicy: params.approvalPolicy ?? "never",
            approvalsReviewer: "user",
            sandbox: { type: "externalSandbox", networkAccess: "restricted" },
            reasoningEffort: requestedEffort,
          })
          return true
        }
        case "turn/start": {
          const threadId = params.threadId
          const prompt = requestPrompt(params)
          let output
          try {
            output = structuredOutput(params, prompt)
          } catch (error) {
            fail(
              id,
              error instanceof Error ? error.message : "invalid output schema",
              -32602,
            )
            return true
          }
          if (!threadEfforts.has(threadId)) {
            fail(id, "thread reasoning effort was not registered", -32602)
            return true
          }
          const turnId = randomUUID()
          respond(id, { turn: turn(turnId, "inProgress") })
          const isFollowupSelection =
            output !== undefined && prompt.includes("<search_results>")
          setTimeout(
            () => emitTurn(notify, threadId, turnId, prompt, output),
            isFollowupSelection ? 2_000 : 20,
          )
          return true
        }
        case "turn/interrupt":
          respond(id, {})
          return true
        default:
          return false
      }
    },
  }
}
