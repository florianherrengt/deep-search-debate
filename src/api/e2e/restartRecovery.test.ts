import { once } from "node:events"
import { access, copyFile, mkdtemp, readFile, rm } from "node:fs/promises"
import { createServer } from "node:net"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { fileURLToPath } from "node:url"
import { spawn, type ChildProcess } from "node:child_process"
import type { Readable, Writable } from "node:stream"

import Database from "better-sqlite3"
import { drizzle } from "drizzle-orm/better-sqlite3"
import { migrate } from "drizzle-orm/better-sqlite3/migrator"
import { afterEach, describe, expect, it } from "vitest"

type ControlMessage = {
  type:
    | "provider-request"
    | "provider-success"
    | "provider-held"
    | "provider-success-held"
    | "db-commit"
    | "db-commit-held"
  key?: string
  occurrence: number
  checkpoint?: string
  promptName?: string | null
  deepSearchJobId?: string | null
  ideaJobId?: string | null
  debateJobId?: string | null
}

type DeepSearchCreated = {
  deepSearchJobId: string
  slug: string
}

type IdeaJobCreated = {
  ideaJobId: string
  slug: string
}

type DebateJobCreated = {
  debateJobId: string
  slug: string
}

type DeepSearchEvent = {
  type: string
  streamId?: string
}

type ApiProcess = {
  child: ChildProcess
  messages: ControlMessage[]
  origin: string
  releaseProvider(key: string, occurrence: number): void
  stop(): Promise<void>
  waitForMessage(
    predicate: (message: ControlMessage) => boolean,
  ): Promise<ControlMessage>
}

const apiDirectory = fileURLToPath(new URL("..", import.meta.url))
const externalServicesPreload = fileURLToPath(
  new URL("./mockExternalServices.mjs", import.meta.url),
)
const migrationsDirectory = fileURLToPath(
  new URL("../drizzle", import.meta.url),
)
const activeProcesses = new Set<ApiProcess>()
const temporaryDirectories = new Set<string>()

function splitLines(
  stream: Readable,
  onLine: (line: string) => void,
): void {
  let buffered = ""
  stream.setEncoding("utf8")
  stream.on("data", (chunk: string) => {
    buffered += chunk
    let newline = buffered.indexOf("\n")
    while (newline !== -1) {
      const line = buffered.slice(0, newline)
      buffered = buffered.slice(newline + 1)
      if (line) onLine(line)
      newline = buffered.indexOf("\n")
    }
  })
}

async function reservePort(): Promise<number> {
  const server = createServer()
  server.listen(0, "127.0.0.1")
  await once(server, "listening")
  const address = server.address()
  if (!address || typeof address === "string") {
    throw new Error("Could not reserve an API test port")
  }
  await new Promise<void>((resolve, reject) =>
    server.close((error) => error ? reject(error) : resolve()),
  )
  return address.port
}

function migrateDatabase(databasePath: string): void {
  const sqlite = new Database(databasePath)
  try {
    migrate(drizzle(sqlite), { migrationsFolder: migrationsDirectory })
  } finally {
    sqlite.close()
  }
}

async function cloneDatabase(sourcePath: string, targetPath: string): Promise<void> {
  const sqlite = new Database(sourcePath)
  try {
    sqlite.pragma("wal_checkpoint(TRUNCATE)")
  } finally {
    sqlite.close()
  }
  await Promise.all([
    rm(`${targetPath}-shm`, { force: true }),
    rm(`${targetPath}-wal`, { force: true }),
  ])
  await copyFile(sourcePath, targetPath)
}

async function createTestState(): Promise<{
  databasePath: string
  ideaSitesDirectory: string
  port: number
  temporaryDirectory: string
}> {
  const temporaryDirectory = await mkdtemp(
    join(tmpdir(), "rethinkloop-restart-"),
  )
  temporaryDirectories.add(temporaryDirectory)
  const databasePath = join(temporaryDirectory, "restart.db")
  migrateDatabase(databasePath)
  return {
    databasePath,
    ideaSitesDirectory: join(temporaryDirectory, "idea-sites"),
    port: await reservePort(),
    temporaryDirectory,
  }
}

async function startApi(input: {
  databasePath: string
  ideaSitesDirectory: string
  port: number
  hold?: Record<string, number[]>
  holdAfterSuccess?: Record<string, number[]>
  postCommitHold?: {
    checkpoint: string
    occurrence?: number
    promptName?: string
  }
}): Promise<ApiProcess> {
  const origin = `http://127.0.0.1:${input.port}`
  const child = spawn(
    process.execPath,
    [
      "--experimental-strip-types",
      `--import=${externalServicesPreload}`,
      "server.ts",
    ],
    {
      cwd: apiDirectory,
      env: {
        ...process.env,
        API_HOST: "127.0.0.1",
        PORT: String(input.port),
        DATABASE_URL: input.databasePath,
        IDEA_SITES_DIR: input.ideaSitesDirectory,
        NODE_ENV: "test",
        BETTER_AUTH_URL: origin,
        BETTER_AUTH_SECRET:
          "restart-proof-secret-that-is-at-least-thirty-two-characters",
        GITHUB_CLIENT_ID: "restart-proof-github-client-id",
        GITHUB_CLIENT_SECRET: "restart-proof-github-client-secret",
        AUTH_DEBUG_USER_ENABLED: "true",
        AUTH_DEBUG_USER_PASSWORD: "restart-proof-password",
        DEEPSEEK_API_KEY: "restart-proof-deepseek-key",
        LLM_PROVIDER: "deepseek",
        LLM_MODEL_NAME: "deepseek-v4-flash",
        LLM_MAX_RETRIES: "0",
        LLM_MAX_CONCURRENT_GENERATIONS: "8",
        SEARXNG_URL: "https://e2e-search.test",
        SEARXNG_MIN_INTERVAL_MS: "0",
        SCRAPINGANT_API_KEY: "e2e-scrapingant-key",
        RESEARCH_MAX_ROOT_JOB_CREATIONS_PER_WINDOW: "100",
        DEEP_SEARCH_MAX_ROOT_JOB_CREATIONS_PER_WINDOW: "100",
        IDEA_JOB_MAX_ROOT_JOB_CREATIONS_PER_WINDOW: "100",
        DEBATE_MAX_ROOT_JOB_CREATIONS_PER_WINDOW: "100",
        RETHINKLOOP_RESTART_CONTROL: "1",
        RETHINKLOOP_RESTART_HOLD: JSON.stringify(input.hold ?? {}),
        RETHINKLOOP_RESTART_HOLD_AFTER_SUCCESS: JSON.stringify(
          input.holdAfterSuccess ?? {},
        ),
        RETHINKLOOP_RESTART_POST_COMMIT: JSON.stringify(
          input.postCommitHold ?? null,
        ),
        NODE_OPTIONS: "",
      },
      stdio: ["ignore", "pipe", "pipe", "pipe", "pipe"],
    },
  )
  const stdout = child.stdout
  const stderr = child.stderr
  if (!stdout || !stderr) {
    throw new Error("API child stdout and stderr pipes were not created")
  }
  const controlOutput = child.stdio[3] as Readable
  const controlInput = child.stdio[4] as Writable
  const messages: ControlMessage[] = []
  const messageWaiters = new Set<{
    predicate: (message: ControlMessage) => boolean
    resolve: (message: ControlMessage) => void
    reject: (error: Error) => void
  }>()
  let stderrOutput = ""
  stderr.setEncoding("utf8")
  stderr.on("data", (chunk: string) => {
    stderrOutput += chunk
  })
  splitLines(controlOutput, (line) => {
    const message = JSON.parse(line) as ControlMessage
    messages.push(message)
    for (const waiter of messageWaiters) {
      if (!waiter.predicate(message)) continue
      messageWaiters.delete(waiter)
      waiter.resolve(message)
    }
  })

  const listening = new Promise<void>((resolve, reject) => {
    splitLines(stdout, (line) => {
      if (line.startsWith("Listening on ")) resolve()
    })
    child.once("exit", (code, signal) => {
      reject(
        new Error(
          `API exited before listening (code=${code}, signal=${signal})\n${stderrOutput}`,
        ),
      )
    })
  })

  const apiProcess: ApiProcess = {
    child,
    messages,
    origin,
    releaseProvider(key, occurrence) {
      controlInput.write(
        `${JSON.stringify({
          type: "release-provider",
          key,
          occurrence,
        })}\n`,
      )
    },
    async stop() {
      if (child.exitCode === null && child.signalCode === null) {
        child.kill("SIGKILL")
        await once(child, "exit")
      }
      activeProcesses.delete(apiProcess)
    },
    waitForMessage(predicate) {
      const existing = messages.find(predicate)
      if (existing) return Promise.resolve(existing)
      return new Promise((resolve, reject) => {
        const waiter = { predicate, resolve, reject }
        messageWaiters.add(waiter)
        child.once("exit", (code, signal) => {
          if (!messageWaiters.delete(waiter)) return
          reject(
            new Error(
              `API exited before the requested checkpoint (code=${code}, signal=${signal})\n${stderrOutput}`,
            ),
          )
        })
      })
    },
  }
  activeProcesses.add(apiProcess)
  await listening
  return apiProcess
}

async function signInAndGrantCredits(api: ApiProcess): Promise<{
  cookie: string
  userId: string
  credits: number
}> {
  const signIn = await fetch(`${api.origin}/api/auth/debug-sign-in`, {
    method: "POST",
    headers: { Origin: api.origin, "X-Debug-Auth": "1" },
  })
  expect(signIn.status).toBe(200)
  const cookies = signIn.headers.getSetCookie()
  const cookie = cookies.map((value) => value.split(";", 1)[0]).join("; ")
  const usersResponse = await fetch(`${api.origin}/api/admin/users`, {
    headers: { Cookie: cookie },
  })
  expect(usersResponse.status).toBe(200)
  const users = await usersResponse.json() as {
    users: Array<{ id: string; name: string; credits: number }>
  }
  const debugUser = users.users.find(({ name }) => name === "Debug User")
  if (!debugUser) throw new Error("Debug user was not created")
  const targetCredits = 1_000_000
  if (debugUser.credits < targetCredits) {
    const grant = await fetch(
      `${api.origin}/api/admin/users/${debugUser.id}/credits`,
      {
        method: "POST",
        headers: {
          Cookie: cookie,
          "Content-Type": "application/json",
          Origin: api.origin,
        },
        body: JSON.stringify({ credits: targetCredits - debugUser.credits }),
      },
    )
    expect(grant.status).toBe(200)
  }
  return { cookie, userId: debugUser.id, credits: targetCredits }
}

async function createDeepSearch(
  api: ApiProcess,
  cookie: string,
  overrides: Partial<{
    researchRequest: string
    maxSearches: number
    maxResultsPerSearch: number
    maxRounds: number
  }> = {},
): Promise<DeepSearchCreated> {
  const response = await fetch(`${api.origin}/api/deep-search-jobs`, {
    method: "POST",
    headers: {
      Cookie: cookie,
      "Content-Type": "application/json",
      Origin: api.origin,
    },
    body: JSON.stringify({
      researchRequest:
        "Research the main energy constraints faced by London renters.",
      maxSearches: 1,
      maxResultsPerSearch: 1,
      maxRounds: 1,
      ...overrides,
    }),
  })
  expect(response.status).toBe(202)
  return response.json() as Promise<DeepSearchCreated>
}

async function createIdeaJob(
  api: ApiProcess,
  cookie: string,
): Promise<IdeaJobCreated> {
  const response = await fetch(`${api.origin}/api/idea-jobs`, {
    method: "POST",
    headers: {
      Cookie: cookie,
      "Content-Type": "application/json",
      Origin: api.origin,
    },
    body: JSON.stringify({
      prompt: "Create practical energy products for London renters.",
      numberOfIdeas: 8,
      deepSearchCount: 2,
      maxSearches: 1,
      maxResultsPerSearch: 1,
      maxRounds: 1,
    }),
  })
  expect(response.status).toBe(202)
  return response.json() as Promise<IdeaJobCreated>
}

async function createDebateJob(
  api: ApiProcess,
  cookie: string,
): Promise<DebateJobCreated> {
  const response = await fetch(`${api.origin}/api/debate-jobs`, {
    method: "POST",
    headers: {
      Cookie: cookie,
      "Content-Type": "application/json",
      Origin: api.origin,
    },
    body: JSON.stringify({
      prompt:
        "Design a practical product that helps small apartment buildings reduce energy use without installing new hardware, changing utility providers, or adding substantial work for residents or building managers.",
      isPublic: false,
      numberOfIdeas: 8,
      deepSearchCount: 1,
      maxSearches: 1,
      maxResultsPerSearch: 1,
      maxRounds: 1,
    }),
  })
  expect(response.status).toBe(202)
  return response.json() as Promise<DebateJobCreated>
}

async function postRootCommand(
  api: ApiProcess,
  cookie: string,
  deepSearchJobId: string,
  command: "cancel" | "resume",
): Promise<Response> {
  return fetch(
    `${api.origin}/api/deep-search-jobs/${deepSearchJobId}/${command}`,
    {
      method: "POST",
      headers: { Cookie: cookie, Origin: api.origin },
    },
  )
}

async function openEventFeed(
  api: ApiProcess,
  cookie: string,
  path: string,
): Promise<{ readAll(): Promise<DeepSearchEvent[]> }> {
  const response = await fetch(
    `${api.origin}${path}`,
    { headers: { Cookie: cookie } },
  )
  expect(response.status).toBe(200)
  if (!response.body) throw new Error("Event feed had no body")
  const reader = response.body.pipeThrough(new TextDecoderStream()).getReader()
  return {
    async readAll() {
      const events: DeepSearchEvent[] = []
      let buffered = ""
      try {
        while (true) {
          const { value, done } = await reader.read()
          if (done) break
          buffered += value
          let newline = buffered.indexOf("\n")
          while (newline !== -1) {
            const line = buffered.slice(0, newline)
            buffered = buffered.slice(newline + 1)
            if (line) events.push(JSON.parse(line) as DeepSearchEvent)
            newline = buffered.indexOf("\n")
          }
        }
      } catch (error) {
        // A deliberate SIGKILL terminates the HTTP socket. Any complete lines
        // received before process death remain useful reconnect evidence.
        if (events.length === 0) throw error
      }
      if (buffered.trim()) {
        events.push(JSON.parse(buffered) as DeepSearchEvent)
      }
      return events
    },
  }
}

function queryDatabase<Result>(
  databasePath: string,
  sql: string,
  ...params: unknown[]
): Result[] {
  const sqlite = new Database(databasePath, { readonly: true })
  try {
    return sqlite.prepare(sql).all(...params) as Result[]
  } finally {
    sqlite.close()
  }
}

function parseJson(value: string): unknown {
  return JSON.parse(value) as unknown
}

function providerMessages(
  processes: ApiProcess[],
  type: ControlMessage["type"],
  key: string,
): ControlMessage[] {
  return processes.flatMap(({ messages }) =>
    messages.filter((message) => message.type === type && message.key === key),
  )
}

function expectCreditsSettledExactlyOnce(
  databasePath: string,
  userId: string,
  startingCredits: number,
): void {
  const [account] = queryDatabase<{ credits: number }>(
    databasePath,
    "select credits from user where id = ?",
    userId,
  )
  const [costs] = queryDatabase<{
    generationCredits: number
    searchCredits: number
    extractionCredits: number
  }>(
    databasePath,
    `select
      coalesce((select sum(credits_used) from llm_generations), 0) as generationCredits,
      coalesce((select sum(credits_used) from deep_search_queries), 0) as searchCredits,
      coalesce((select sum(credits_used) from deep_search_web_pages), 0) as extractionCredits`,
  )
  const settledCredits =
    costs.generationCredits + costs.searchCredits + costs.extractionCredits
  expect(startingCredits - account.credits).toBe(settledCredits)
}

function canonicalDeepSearchSnapshot(
  databasePath: string,
  deepSearchJobId: string,
): unknown {
  const [job] = queryDatabase<{
    status: string
    error: string | null
    researchRequest: string
    maxSearches: number
    maxResultsPerSearch: number
    maxRounds: number
    strictQuality: number
    finalAnswer: string
    researchAnalysis: string
  }>(
    databasePath,
    `select job.status, job.error,
            job.research_request as researchRequest,
            job.max_searches as maxSearches,
            job.max_results_per_search as maxResultsPerSearch,
            job.max_rounds as maxRounds,
            job.strict_quality as strictQuality,
            answer.text as finalAnswer,
            analysis.text as researchAnalysis
     from deep_search_jobs job
     inner join llm_generations answer
       on answer.llm_generation_id = job.final_answer_generation_id
     inner join llm_generations analysis
       on analysis.llm_generation_id = job.research_analysis_generation_id
     where job.deep_search_job_id = ?`,
    deepSearchJobId,
  )
  const rounds = queryDatabase<{
    position: number
    planning: string
    answer: string
    reviewDecision: string | null
    reviewReason: string | null
    reviewError: string | null
  }>(
    databasePath,
    `select round.position, planning.text as planning,
            answer.text as answer,
            round.review_decision as reviewDecision,
            round.review_reason as reviewReason,
            round.review_error as reviewError
     from deep_search_rounds round
     inner join llm_generations planning
       on planning.llm_generation_id = round.llm_generation_id
     inner join llm_generations answer
       on answer.llm_generation_id = round.answer_generation_id
     where round.deep_search_job_id = ? order by round.position`,
    deepSearchJobId,
  )
  const queries = queryDatabase<{
    roundPosition: number
    position: number
    query: string
    status: string
    creditsUsed: number
    selectionStatus: string
    summary: string
  }>(
    databasePath,
    `select round.position as roundPosition, query.position, query.query,
            query.status, query.credits_used as creditsUsed,
            selection.status as selectionStatus,
            summary.text as summary
     from deep_search_queries query
     inner join deep_search_rounds round
       on round.deep_search_round_id = query.deep_search_round_id
     inner join llm_generations selection
       on selection.llm_generation_id = query.selection_generation_id
     inner join llm_generations summary
       on summary.llm_generation_id = query.summary_generation_id
     where round.deep_search_job_id = ?
     order by round.position, query.position`,
    deepSearchJobId,
  )
  const results = queryDatabase<{
    roundPosition: number
    queryPosition: number
    position: number
    title: string
    shortText: string
    url: string
    selected: number
  }>(
    databasePath,
    `select round.position as roundPosition,
            query.position as queryPosition, result.position,
            result.title, result.short_text as shortText, result.url,
            case when result.selected_web_page_id is null then 0 else 1 end as selected
     from deep_search_results result
     inner join deep_search_queries query
       on query.deep_search_query_id = result.deep_search_query_id
     inner join deep_search_rounds round
       on round.deep_search_round_id = query.deep_search_round_id
     where round.deep_search_job_id = ?
     order by round.position, query.position, result.position`,
    deepSearchJobId,
  )
  const pages = queryDatabase<{
    url: string
    status: string
    creditsUsed: number
    summary: string
    errorStage: string | null
    errorMessage: string | null
  }>(
    databasePath,
    `select page.url, page.status, page.credits_used as creditsUsed,
            summary.text as summary,
            page.error_stage as errorStage,
            page.error_message as errorMessage
     from deep_search_web_pages page
     inner join llm_generations summary
       on summary.llm_generation_id = page.summary_generation_id
     where page.deep_search_job_id = ? order by page.url`,
    deepSearchJobId,
  )

  return {
    ...job,
    researchAnalysis: parseJson(job.researchAnalysis),
    rounds,
    queries: queries.map((query) => ({
      ...query,
      results: results.filter(
        (result) =>
          result.roundPosition === query.roundPosition &&
          result.queryPosition === query.position,
      ),
    })),
    pages,
  }
}

function canonicalIdeaSnapshot(
  databasePath: string,
  ideaJobId: string,
): unknown {
  const [job] = queryDatabase<{
    status: string
    stage: string
    error: string | null
    prompt: string
    numberOfIdeas: number
    deepSearchCount: number
    maxSearches: number
    maxResultsPerSearch: number
    maxRounds: number
    researchPrompts: string
    researchSummary: string
    generatedIdeas: string
    selectionStatus: string
  }>(
    databasePath,
    `select job.status, job.stage, job.error, job.prompt,
            job.number_of_ideas as numberOfIdeas,
            job.deep_search_count as deepSearchCount,
            job.max_searches as maxSearches,
            job.max_results_per_search as maxResultsPerSearch,
            job.max_rounds as maxRounds,
            prompts.text as researchPrompts,
            summary.text as researchSummary,
            generation.text as generatedIdeas,
            selection.status as selectionStatus
     from idea_jobs job
     inner join llm_generations prompts
       on prompts.llm_generation_id = job.research_prompt_generation_id
     inner join llm_generations summary
       on summary.llm_generation_id = job.research_summary_generation_id
     inner join llm_generations generation
       on generation.llm_generation_id = job.idea_generation_id
     inner join llm_generations selection
       on selection.llm_generation_id = job.selection_generation_id
     where job.idea_job_id = ?`,
    ideaJobId,
  )
  const ideas = queryDatabase<{
    position: number
    title: string
    description: string
    selected: number
    refinedTitle: string
    refinedDescription: string
    refinement: string
    evaluation: string
  }>(
    databasePath,
    `select idea.position, idea.title, idea.description, idea.selected,
            idea.refined_title as refinedTitle,
            idea.refined_description as refinedDescription,
            refinement.text as refinement,
            evaluation.text as evaluation
     from ideas idea
     inner join llm_generations refinement
       on refinement.llm_generation_id = idea.refinement_generation_id
     inner join llm_generations evaluation
       on evaluation.llm_generation_id = idea.evaluation_generation_id
     where idea.idea_job_id = ? order by idea.position`,
    ideaJobId,
  )
  const children = queryDatabase<{
    deepSearchJobId: string
    position: number
  }>(
    databasePath,
    `select deep_search_job_id as deepSearchJobId,
            idea_job_position as position
     from deep_search_jobs where idea_job_id = ?
     order by idea_job_position`,
    ideaJobId,
  )

  return {
    ...job,
    researchPrompts: parseJson(job.researchPrompts),
    generatedIdeas: parseJson(job.generatedIdeas),
    ideas: ideas.map((idea) => ({
      ...idea,
      refinement: parseJson(idea.refinement),
      evaluation: parseJson(idea.evaluation),
    })),
    children: children.map(({ deepSearchJobId, position }) => ({
      position,
      snapshot: canonicalDeepSearchSnapshot(databasePath, deepSearchJobId),
    })),
  }
}

function canonicalDebateSnapshot(
  databasePath: string,
  debateJobId: string,
): unknown {
  const [job] = queryDatabase<{
    status: string
    stage: string
    error: string | null
    randomSeed: number
    isPublic: number
    ideaJobId: string
    website: string
  }>(
    databasePath,
    `select debate.status, debate.stage, debate.error,
            debate.random_seed as randomSeed,
            debate.is_public as isPublic,
            idea.idea_job_id as ideaJobId,
            website.text as website
     from debate_jobs debate
     inner join idea_jobs idea on idea.debate_job_id = debate.debate_job_id
     inner join llm_generations website
       on website.llm_generation_id = debate.website_generation_id
     where debate.debate_job_id = ?`,
    debateJobId,
  )
  const matches = queryDatabase<{
    stage: string
    stageRoundNumber: number
    position: number
    firstIdeaPosition: number
    secondIdeaPosition: number
    winnerIdeaPosition: number
  }>(
    databasePath,
    `select round.stage,
            round.stage_round_number as stageRoundNumber,
            match.position,
            first_idea.position as firstIdeaPosition,
            second_idea.position as secondIdeaPosition,
            winner_idea.position as winnerIdeaPosition
     from debate_matches match
     inner join debate_rounds round
       on round.debate_round_id = match.debate_round_id
     inner join ideas first_idea
       on first_idea.idea_id = match.first_idea_id
     inner join ideas second_idea
       on second_idea.idea_id = match.second_idea_id
     inner join ideas winner_idea
       on winner_idea.idea_id = match.winner_idea_id
     where round.debate_job_id = ?
     order by case round.stage
                when 'swiss' then 0 when 'semifinal' then 1 else 2 end,
              round.stage_round_number, match.position`,
    debateJobId,
  )
  const messages = queryDatabase<{
    stage: string
    stageRoundNumber: number
    matchPosition: number
    position: number
    speakerSlot: number
    text: string
  }>(
    databasePath,
    `select round.stage,
            round.stage_round_number as stageRoundNumber,
            match.position as matchPosition,
            message.position, message.speaker_slot as speakerSlot,
            generation.text
     from debate_messages message
     inner join debate_matches match
       on match.debate_match_id = message.debate_match_id
     inner join debate_rounds round
       on round.debate_round_id = match.debate_round_id
     inner join llm_generations generation
       on generation.llm_generation_id = message.llm_generation_id
     where round.debate_job_id = ?
     order by case round.stage
                when 'swiss' then 0 when 'semifinal' then 1 else 2 end,
              round.stage_round_number, match.position, message.position`,
    debateJobId,
  )

  const { ideaJobId, ...debate } = job
  return {
    ...debate,
    idea: canonicalIdeaSnapshot(databasePath, ideaJobId),
    matches,
    messages,
  }
}

afterEach(async () => {
  await Promise.all([...activeProcesses].map((api) => api.stop()))
  await Promise.all(
    [...temporaryDirectories].map(async (directory) => {
      await rm(directory, { force: true, recursive: true })
      temporaryDirectories.delete(directory)
    }),
  )
})

describe("file-backed process restart recovery", () => {
  it("replaces only a registered in-flight stage and reconnects from its durable prefix", { timeout: 120_000 }, async () => {
    const state = await createTestState()
    const planningKey = "llm:generate-websearch-queries:constraints"
    const searchKey =
      "search:London renter household energy constraints evidence"
    const first = await startApi({
      ...state,
      hold: { [planningKey]: [1] },
    })
    const session = await signInAndGrantCredits(first)
    const created = await createDeepSearch(first, session.cookie)
    await first.waitForMessage(
      (message) => message.type === "provider-held" && message.key === planningKey,
    )

    const [registeredAttempt] = queryDatabase<{
      llmGenerationId: string
      status: string
    }>(
      state.databasePath,
      `select g.llm_generation_id as llmGenerationId, g.status
       from llm_generations g
       inner join deep_search_rounds r on r.llm_generation_id = g.llm_generation_id
       where r.deep_search_job_id = ?`,
      created.deepSearchJobId,
    )
    expect(registeredAttempt).toMatchObject({ status: "running" })
    const [beforeRestartCounts] = queryDatabase<{ rounds: number }>(
      state.databasePath,
      "select count(*) as rounds from deep_search_rounds where deep_search_job_id = ?",
      created.deepSearchJobId,
    )
    expect(beforeRestartCounts.rounds).toBe(1)
    await first.stop()

    const second = await startApi({
      ...state,
      holdAfterSuccess: { [searchKey]: [1] },
    })
    await second.waitForMessage(
      (message) =>
        message.type === "provider-success-held" && message.key === searchKey,
    )
    const crashedFeed = await openEventFeed(
      second,
      session.cookie,
      `/api/deep-search-jobs/${created.deepSearchJobId}/events`,
    )
    const [unsettledSearch] = queryDatabase<{
      status: string
      creditsUsed: number | null
      results: number
    }>(
      state.databasePath,
      `select q.status, q.credits_used as creditsUsed,
              (select count(*) from deep_search_results r
               where r.deep_search_query_id = q.deep_search_query_id) as results
       from deep_search_queries q
       inner join deep_search_rounds round
         on round.deep_search_round_id = q.deep_search_round_id
       where round.deep_search_job_id = ?`,
      created.deepSearchJobId,
    )
    expect(unsettledSearch).toEqual({
      status: "searching",
      creditsUsed: null,
      results: 0,
    })
    const [completedPlanning] = queryDatabase<{
      llmGenerationId: string
      status: string
    }>(
      state.databasePath,
      `select g.llm_generation_id as llmGenerationId, g.status
       from llm_generations g
       inner join deep_search_rounds r on r.llm_generation_id = g.llm_generation_id
       where r.deep_search_job_id = ?`,
      created.deepSearchJobId,
    )
    expect(completedPlanning.status).toBe("completed")
    await second.stop()
    const crashedEvents = await crashedFeed.readAll()
    expect(crashedEvents[0]).toEqual({
      type: "query-stream",
      round: 0,
      streamId: registeredAttempt.llmGenerationId,
    })

    const third = await startApi({
      ...state,
      hold: { [searchKey]: [1] },
      postCommitHold: {
        checkpoint: "generation-settled",
        promptName: "analyze-research-answer",
      },
    })
    await third.waitForMessage(
      (message) => message.type === "provider-held" && message.key === searchKey,
    )
    const eventFeed = await openEventFeed(
      third,
      session.cookie,
      `/api/deep-search-jobs/${created.deepSearchJobId}/events`,
    )
    third.releaseProvider(searchKey, 1)
    await third.waitForMessage(
      (message) =>
        message.type === "db-commit-held" &&
        message.promptName === "analyze-research-answer",
    )
    const [beforePromotion] = queryDatabase<{
      status: string
      analysisStatus: string
    }>(
      state.databasePath,
      `select j.status,
              generation.status as analysisStatus
       from deep_search_jobs j
       inner join llm_generations generation
         on generation.llm_generation_id = j.research_analysis_generation_id
       where j.deep_search_job_id = ?`,
      created.deepSearchJobId,
    )
    expect(beforePromotion).toEqual({
      status: "running",
      analysisStatus: "completed",
    })
    await third.stop()
    const beforePromotionEvents = await eventFeed.readAll()

    expect(beforePromotionEvents[0]).toEqual({
      type: "query-stream",
      round: 0,
      streamId: completedPlanning.llmGenerationId,
    })

    const fourth = await startApi(state)
    const completedFeed = await openEventFeed(
      fourth,
      session.cookie,
      `/api/deep-search-jobs/${created.deepSearchJobId}/events`,
    )
    const events = await completedFeed.readAll()
    expect(events.filter(({ type }) => type === "done")).toHaveLength(1)
    expect(events.at(-1)).toEqual({ type: "done" })
    expect(
      providerMessages(
        [fourth],
        "provider-request",
        "llm:analyze-research-answer:constraints",
      ),
    ).toEqual([])

    const attempts = queryDatabase<{
      llmGenerationId: string
      status: string
      creditsUsed: number | null
    }>(
      state.databasePath,
      `select llm_generation_id as llmGenerationId, status,
              credits_used as creditsUsed
       from llm_generations
       where deep_search_job_id = ? and prompt_name = ?
       order by started_at, llm_generation_id`,
      created.deepSearchJobId,
      "generate-websearch-queries",
    )
    expect(attempts).toHaveLength(2)
    expect(attempts).toContainEqual({
      llmGenerationId: registeredAttempt.llmGenerationId,
      status: "interrupted",
      creditsUsed: null,
    })
    expect(attempts.filter(({ status }) => status === "completed")).toHaveLength(1)
    expect(attempts.filter(({ creditsUsed }) => creditsUsed !== null)).toHaveLength(1)

    const [afterRestartCounts] = queryDatabase<{
      rounds: number
      queries: number
      pages: number
    }>(
      state.databasePath,
      `select
        (select count(*) from deep_search_rounds where deep_search_job_id = ?) as rounds,
        (select count(*) from deep_search_queries q inner join deep_search_rounds r on r.deep_search_round_id = q.deep_search_round_id where r.deep_search_job_id = ?) as queries,
        (select count(*) from deep_search_web_pages where deep_search_job_id = ?) as pages`,
      created.deepSearchJobId,
      created.deepSearchJobId,
      created.deepSearchJobId,
    )
    expect(afterRestartCounts).toEqual({ rounds: 1, queries: 1, pages: 1 })
    const [finalOutput] = queryDatabase<{
      status: string
      answer: string
      analysis: string
    }>(
      state.databasePath,
      `select job.status, answer.text as answer, analysis.text as analysis
       from deep_search_jobs job
       inner join llm_generations answer
         on answer.llm_generation_id = job.final_answer_generation_id
       inner join llm_generations analysis
         on analysis.llm_generation_id = job.research_analysis_generation_id
       where job.deep_search_job_id = ?`,
      created.deepSearchJobId,
    )
    expect(finalOutput.status).toBe("completed")
    expect(finalOutput.answer).toBe(
      "London renters face insulation, heating-control, and landlord-permission constraints.",
    )
    expect(JSON.parse(finalOutput.analysis)).toMatchObject({
      facts: [{ title: "The supplied evidence supports the answer" }],
    })
    expectCreditsSettledExactlyOnce(
      state.databasePath,
      session.userId,
      session.credits,
    )
    expect(providerMessages([first, second, third, fourth], "provider-request", planningKey)).toHaveLength(2)
    expect(providerMessages([second, third], "provider-request", searchKey)).toHaveLength(2)
    expect(providerMessages([second, third], "provider-success", searchKey)).toHaveLength(2)
    expect(
      providerMessages(
        [first, second, third, fourth],
        "provider-request",
        "llm:generate-prompt-title",
      ),
    ).toHaveLength(1)

    const resumedSnapshot = canonicalDeepSearchSnapshot(
      state.databasePath,
      created.deepSearchJobId,
    )
    const controlState = await createTestState()
    const controlApi = await startApi(controlState)
    const controlSession = await signInAndGrantCredits(controlApi)
    const controlCreated = await createDeepSearch(
      controlApi,
      controlSession.cookie,
    )
    const controlFeed = await openEventFeed(
      controlApi,
      controlSession.cookie,
      `/api/deep-search-jobs/${controlCreated.deepSearchJobId}/events`,
    )
    const controlEvents = await controlFeed.readAll()
    expect(controlEvents.filter(({ type }) => type === "done")).toHaveLength(1)
    expect(resumedSnapshot).toEqual(
      canonicalDeepSearchSnapshot(
        controlState.databasePath,
        controlCreated.deepSearchJobId,
      ),
    )
    await controlApi.stop()

    await fourth.stop()
    const completedRestart = await startApi(state)
    const response = await fetch(
      `${completedRestart.origin}/api/deep-search-jobs/${created.slug}`,
      { headers: { Cookie: session.cookie } },
    )
    expect(response.status).toBe(200)
    expect(
      completedRestart.messages.filter(({ type }) => type === "provider-request"),
    ).toEqual([])
  })

  it("automatically resumes a stopped root and deduplicates concurrent Resume requests", { timeout: 120_000 }, async () => {
    const state = await createTestState()
    const planningKey = "llm:generate-websearch-queries:constraints"
    const first = await startApi({
      ...state,
      hold: { [planningKey]: [1] },
    })
    const session = await signInAndGrantCredits(first)
    const created = await createDeepSearch(first, session.cookie)
    await first.waitForMessage(
      (message) => message.type === "provider-held" && message.key === planningKey,
    )
    const stoppedFeed = await openEventFeed(
      first,
      session.cookie,
      `/api/deep-search-jobs/${created.deepSearchJobId}/events`,
    )
    const stopResponse = await postRootCommand(
      first,
      session.cookie,
      created.deepSearchJobId,
      "cancel",
    )
    expect(stopResponse.status).toBe(202)
    const stoppedEvents = await stoppedFeed.readAll()
    expect(stoppedEvents.map(({ type }) => type).slice(-3)).toEqual([
      "stop-requested",
      "interrupted",
      "done",
    ])
    const [stoppedJob] = queryDatabase<{
      status: string
      cancelRequestedAt: number | null
    }>(
      state.databasePath,
      `select status, cancel_requested_at as cancelRequestedAt
       from deep_search_jobs where deep_search_job_id = ?`,
      created.deepSearchJobId,
    )
    expect(stoppedJob.status).toBe("interrupted")
    expect(stoppedJob.cancelRequestedAt).not.toBeNull()
    await first.stop()

    const resumed = await startApi({
      ...state,
      hold: { [planningKey]: [1] },
    })
    await resumed.waitForMessage(
      (message) => message.type === "provider-held" && message.key === planningKey,
    )
    const resumedFeed = await openEventFeed(
      resumed,
      session.cookie,
      `/api/deep-search-jobs/${created.deepSearchJobId}/events`,
    )
    const resumeResponses = await Promise.all([
      postRootCommand(
        resumed,
        session.cookie,
        created.deepSearchJobId,
        "resume",
      ),
      postRootCommand(
        resumed,
        session.cookie,
        created.deepSearchJobId,
        "resume",
      ),
    ])
    expect(resumeResponses.map(({ status }) => status)).toEqual([202, 202])
    expect(providerMessages([resumed], "provider-request", planningKey)).toHaveLength(1)
    resumed.releaseProvider(planningKey, 1)
    const events = await resumedFeed.readAll()
    expect(events.filter(({ type }) => type === "stop-requested")).toEqual([])
    expect(events.filter(({ type }) => type === "interrupted")).toEqual([])
    expect(events.filter(({ type }) => type === "done")).toHaveLength(1)

    const [completedJob] = queryDatabase<{
      status: string
      cancelRequestedAt: number | null
    }>(
      state.databasePath,
      `select status, cancel_requested_at as cancelRequestedAt
       from deep_search_jobs where deep_search_job_id = ?`,
      created.deepSearchJobId,
    )
    expect(completedJob).toEqual({ status: "completed", cancelRequestedAt: null })
    expectCreditsSettledExactlyOnce(
      state.databasePath,
      session.userId,
      session.credits,
    )
  })

  it("preserves a settled deep-search fan-out sibling while retrying only the held search", { timeout: 120_000 }, async () => {
    const state = await createTestState()
    const firstSearchKey =
      "search:London renter household energy constraints evidence primary"
    const secondSearchKey =
      "search:London renter household energy constraints evidence secondary"
    const first = await startApi({
      ...state,
      hold: { [secondSearchKey]: [1] },
      postCommitHold: { checkpoint: "search-query-settled" },
    })
    const session = await signInAndGrantCredits(first)
    const created = await createDeepSearch(first, session.cookie, {
      researchRequest:
        "[E2E_RESTART_TWO_QUERIES] Research the main energy constraints faced by London renters.",
      maxSearches: 2,
    })
    await first.waitForMessage(
      (message) =>
        message.type === "provider-held" && message.key === secondSearchKey,
    )
    await first.waitForMessage(
      (message) =>
        message.type === "db-commit-held" &&
        message.checkpoint === "search-query-settled",
    )
    const queriesBefore = queryDatabase<{
      deepSearchQueryId: string
      position: number
      status: string
      creditsUsed: number | null
      results: number
    }>(
      state.databasePath,
      `select q.deep_search_query_id as deepSearchQueryId, q.position,
              q.status, q.credits_used as creditsUsed,
              (select count(*) from deep_search_results result
               where result.deep_search_query_id = q.deep_search_query_id) as results
       from deep_search_queries q
       inner join deep_search_rounds round
         on round.deep_search_round_id = q.deep_search_round_id
       where round.deep_search_job_id = ? order by q.position`,
      created.deepSearchJobId,
    )
    expect(queriesBefore).toHaveLength(2)
    expect(queriesBefore[0]).toMatchObject({
      position: 0,
      status: "selecting",
      results: 2,
    })
    expect(queriesBefore[0].creditsUsed).not.toBeNull()
    expect(queriesBefore[1]).toMatchObject({
      position: 1,
      status: "searching",
      creditsUsed: null,
      results: 0,
    })
    await first.stop()

    const second = await startApi(state)
    const eventFeed = await openEventFeed(
      second,
      session.cookie,
      `/api/deep-search-jobs/${created.deepSearchJobId}/events`,
    )
    const events = await eventFeed.readAll()
    expect(events.filter(({ type }) => type === "done")).toHaveLength(1)
    const queriesAfter = queryDatabase<{
      deepSearchQueryId: string
      position: number
      status: string
      creditsUsed: number | null
    }>(
      state.databasePath,
      `select q.deep_search_query_id as deepSearchQueryId, q.position,
              q.status, q.credits_used as creditsUsed
       from deep_search_queries q
       inner join deep_search_rounds round
         on round.deep_search_round_id = q.deep_search_round_id
       where round.deep_search_job_id = ? order by q.position`,
      created.deepSearchJobId,
    )
    expect(queriesAfter.map(({ deepSearchQueryId }) => deepSearchQueryId)).toEqual(
      queriesBefore.map(({ deepSearchQueryId }) => deepSearchQueryId),
    )
    expect(queriesAfter.map(({ status }) => status)).toEqual([
      "completed",
      "completed",
    ])
    expect(
      providerMessages([second], "provider-request", firstSearchKey),
    ).toEqual([])
    expect(
      providerMessages(
        [first, second],
        "provider-request",
        firstSearchKey,
      ),
    ).toHaveLength(1)
    expect(
      providerMessages(
        [first, second],
        "provider-request",
        secondSearchKey,
      ),
    ).toHaveLength(2)
    const [counts] = queryDatabase<{ queries: number; pages: number }>(
      state.databasePath,
      `select
        (select count(*) from deep_search_queries q inner join deep_search_rounds r on r.deep_search_round_id = q.deep_search_round_id where r.deep_search_job_id = ?) as queries,
        (select count(*) from deep_search_web_pages where deep_search_job_id = ?) as pages`,
      created.deepSearchJobId,
      created.deepSearchJobId,
    )
    expect(counts).toEqual({ queries: 2, pages: 2 })
    expectCreditsSettledExactlyOnce(
      state.databasePath,
      session.userId,
      session.credits,
    )
  })

  it("reuses a completed idea child while resuming its held fan-out sibling", { timeout: 180_000 }, async () => {
    const state = await createTestState()
    const heldPlanningKey =
      "llm:generate-websearch-queries:interventions"
    const first = await startApi({
      ...state,
      hold: { [heldPlanningKey]: [1] },
      postCommitHold: { checkpoint: "deep-search-completed" },
    })
    const session = await signInAndGrantCredits(first)
    const created = await createIdeaJob(first, session.cookie)
    await first.waitForMessage(
      (message) =>
        message.type === "provider-held" &&
        message.key === heldPlanningKey,
    )
    const completedCheckpoint = await first.waitForMessage(
      (message) =>
        message.type === "db-commit-held" &&
        message.checkpoint === "deep-search-completed",
    )
    const initialChildren = queryDatabase<{
      deepSearchJobId: string
      position: number
      status: string
      finalAnswerGenerationId: string | null
      completedAt: number | null
    }>(
      state.databasePath,
      `select deep_search_job_id as deepSearchJobId,
              idea_job_position as position, status,
              final_answer_generation_id as finalAnswerGenerationId,
              completed_at as completedAt
       from deep_search_jobs
       where idea_job_id = ? and idea_job_position < 2
       order by idea_job_position`,
      created.ideaJobId,
    )
    expect(initialChildren).toHaveLength(2)
    const completedChild = initialChildren.find(
      ({ deepSearchJobId }) =>
        deepSearchJobId === completedCheckpoint.deepSearchJobId,
    )
    if (!completedChild) {
      throw new Error("Completed child checkpoint did not name an initial child")
    }
    expect(completedChild).toMatchObject({
      position: 0,
      status: "completed",
    })
    expect(initialChildren[1]).toMatchObject({
      position: 1,
      status: "running",
    })
    const [completedCountsBefore] = queryDatabase<{
      rounds: number
      queries: number
      pages: number
    }>(
      state.databasePath,
      `select
        (select count(*) from deep_search_rounds where deep_search_job_id = ?) as rounds,
        (select count(*) from deep_search_queries q inner join deep_search_rounds r on r.deep_search_round_id = q.deep_search_round_id where r.deep_search_job_id = ?) as queries,
        (select count(*) from deep_search_web_pages where deep_search_job_id = ?) as pages`,
      completedChild.deepSearchJobId,
      completedChild.deepSearchJobId,
      completedChild.deepSearchJobId,
    )
    await first.stop()

    const second = await startApi(state)
    const eventFeed = await openEventFeed(
      second,
      session.cookie,
      `/api/idea-jobs/${created.ideaJobId}/events`,
    )
    const events = await eventFeed.readAll()
    expect(events.filter(({ type }) => type === "done")).toHaveLength(1)

    const [completedChildAfter] = queryDatabase<{
      deepSearchJobId: string
      position: number
      status: string
      finalAnswerGenerationId: string | null
      completedAt: number | null
    }>(
      state.databasePath,
      `select deep_search_job_id as deepSearchJobId,
              idea_job_position as position, status,
              final_answer_generation_id as finalAnswerGenerationId,
              completed_at as completedAt
       from deep_search_jobs where deep_search_job_id = ?`,
      completedChild.deepSearchJobId,
    )
    expect(completedChildAfter).toEqual(completedChild)
    const [completedCountsAfter] = queryDatabase<{
      rounds: number
      queries: number
      pages: number
    }>(
      state.databasePath,
      `select
        (select count(*) from deep_search_rounds where deep_search_job_id = ?) as rounds,
        (select count(*) from deep_search_queries q inner join deep_search_rounds r on r.deep_search_round_id = q.deep_search_round_id where r.deep_search_job_id = ?) as queries,
        (select count(*) from deep_search_web_pages where deep_search_job_id = ?) as pages`,
      completedChild.deepSearchJobId,
      completedChild.deepSearchJobId,
      completedChild.deepSearchJobId,
    )
    expect(completedCountsAfter).toEqual(completedCountsBefore)
    expect(
      second.messages.filter(
        (message) =>
          message.type === "provider-request" &&
          message.key?.includes("constraints"),
      ),
    ).toEqual([])
    expect(
      providerMessages(
        [first, second],
        "provider-request",
        heldPlanningKey,
      ),
    ).toHaveLength(2)
    const childPositions = queryDatabase<{ position: number }>(
      state.databasePath,
      `select idea_job_position as position from deep_search_jobs
       where idea_job_id = ? order by idea_job_position`,
      created.ideaJobId,
    )
    expect(childPositions.map(({ position }) => position)).toEqual(
      Array.from({ length: 10 }, (_, position) => position),
    )
    const [ideaJob] = queryDatabase<{
      status: string
      ideas: number
      selectedIdeas: number
      refinedIdeas: number
      evaluatedIdeas: number
    }>(
      state.databasePath,
      `select job.status,
        (select count(*) from ideas where idea_job_id = job.idea_job_id) as ideas,
        (select count(*) from ideas where idea_job_id = job.idea_job_id and selected = 1) as selectedIdeas,
        (select count(*) from ideas where idea_job_id = job.idea_job_id and refined_title is not null and refined_description is not null) as refinedIdeas,
        (select count(*) from ideas idea inner join llm_generations generation on generation.llm_generation_id = idea.evaluation_generation_id where idea.idea_job_id = job.idea_job_id and generation.status = 'completed') as evaluatedIdeas
       from idea_jobs job where job.idea_job_id = ?`,
      created.ideaJobId,
    )
    expect(ideaJob).toEqual({
      status: "completed",
      ideas: 8,
      selectedIdeas: 8,
      refinedIdeas: 8,
      evaluatedIdeas: 8,
    })
    expectCreditsSettledExactlyOnce(
      state.databasePath,
      session.userId,
      session.credits,
    )

    const resumedSnapshot = canonicalIdeaSnapshot(
      state.databasePath,
      created.ideaJobId,
    )
    const controlState = await createTestState()
    const controlApi = await startApi(controlState)
    const controlSession = await signInAndGrantCredits(controlApi)
    const controlCreated = await createIdeaJob(controlApi, controlSession.cookie)
    const controlFeed = await openEventFeed(
      controlApi,
      controlSession.cookie,
      `/api/idea-jobs/${controlCreated.ideaJobId}/events`,
    )
    const controlEvents = await controlFeed.readAll()
    expect(controlEvents.filter(({ type }) => type === "done")).toHaveLength(1)
    expect(resumedSnapshot).toEqual(
      canonicalIdeaSnapshot(
        controlState.databasePath,
        controlCreated.ideaJobId,
      ),
    )
    await controlApi.stop()
  })

  it("reuses a persisted final verdict and writes a settled winner website after two restarts", { timeout: 180_000 }, async () => {
    const seedState = await createTestState()
    const seedApi = await startApi({
      ...seedState,
      postCommitHold: { checkpoint: "idea-job-completed" },
    })
    const session = await signInAndGrantCredits(seedApi)
    const created = await createDebateJob(seedApi, session.cookie)
    await seedApi.waitForMessage(
      (message) =>
        message.type === "db-commit-held" &&
        message.checkpoint === "idea-job-completed" &&
        message.debateJobId === created.debateJobId,
    )
    const [seedPrefix] = queryDatabase<{
      debateStatus: string
      ideaStatus: string
      rounds: number
    }>(
      seedState.databasePath,
      `select debate.status as debateStatus, idea.status as ideaStatus,
              (select count(*) from debate_rounds
               where debate_job_id = debate.debate_job_id) as rounds
       from debate_jobs debate
       inner join idea_jobs idea on idea.debate_job_id = debate.debate_job_id
       where debate.debate_job_id = ?`,
      created.debateJobId,
    )
    expect(seedPrefix).toEqual({
      debateStatus: "running",
      ideaStatus: "completed",
      rounds: 0,
    })
    await seedApi.stop()

    const state = await createTestState()
    const controlState = await createTestState()
    await cloneDatabase(seedState.databasePath, state.databasePath)
    await cloneDatabase(seedState.databasePath, controlState.databasePath)

    const controlApi = await startApi(controlState)
    const controlFeed = await openEventFeed(
      controlApi,
      session.cookie,
      `/api/debate-jobs/${created.debateJobId}/events`,
    )
    const controlEvents = await controlFeed.readAll()
    expect(controlEvents.filter(({ type }) => type === "done")).toHaveLength(1)
    const controlSnapshot = canonicalDebateSnapshot(
      controlState.databasePath,
      created.debateJobId,
    )
    await controlApi.stop()

    const first = await startApi({
      ...state,
      postCommitHold: { checkpoint: "final-verdict" },
    })
    await first.waitForMessage(
      (message) =>
        message.type === "db-commit-held" &&
        message.checkpoint === "final-verdict" &&
        message.debateJobId === created.debateJobId,
    )
    const [verdictState] = queryDatabase<{
      status: string
      websiteGenerationId: string | null
      winnerIdeaId: string
      rounds: number
      matches: number
      messages: number
    }>(
      state.databasePath,
      `select debate.status,
              debate.website_generation_id as websiteGenerationId,
              final_match.winner_idea_id as winnerIdeaId,
              (select count(*) from debate_rounds where debate_job_id = debate.debate_job_id) as rounds,
              (select count(*) from debate_matches match_count inner join debate_rounds round_count on round_count.debate_round_id = match_count.debate_round_id where round_count.debate_job_id = debate.debate_job_id) as matches,
              (select count(*) from debate_messages message_count inner join debate_matches message_match on message_match.debate_match_id = message_count.debate_match_id inner join debate_rounds message_round on message_round.debate_round_id = message_match.debate_round_id where message_round.debate_job_id = debate.debate_job_id) as messages
       from debate_jobs debate
       inner join debate_rounds final_round
         on final_round.debate_job_id = debate.debate_job_id
        and final_round.stage = 'final'
       inner join debate_matches final_match
         on final_match.debate_round_id = final_round.debate_round_id
       where debate.debate_job_id = ?`,
      created.debateJobId,
    )
    expect(verdictState.status).toBe("running")
    expect(verdictState.websiteGenerationId).toBeNull()
    expect(verdictState.winnerIdeaId).toBeTruthy()
    const finalJudgeRequests = providerMessages(
      [first],
      "provider-request",
      "llm:debate-judge",
    ).length
    expect(finalJudgeRequests).toBeGreaterThan(0)
    await first.stop()

    const second = await startApi({
      ...state,
      postCommitHold: {
        checkpoint: "generation-settled",
        promptName: "create-idea-site",
      },
    })
    await second.waitForMessage(
      (message) =>
        message.type === "db-commit-held" &&
        message.promptName === "create-idea-site" &&
        message.debateJobId === created.debateJobId,
    )
    const [settledWebsite] = queryDatabase<{
      generationId: string
      status: string
      text: string
    }>(
      state.databasePath,
      `select generation.llm_generation_id as generationId,
              generation.status, generation.text
       from debate_jobs debate
       inner join llm_generations generation
         on generation.llm_generation_id = debate.website_generation_id
       where debate.debate_job_id = ?`,
      created.debateJobId,
    )
    expect(settledWebsite.status).toBe("completed")
    const websitePath = join(
      state.ideaSitesDirectory,
      verdictState.winnerIdeaId,
      "websites",
      "index.html",
    )
    await expect(access(websitePath)).rejects.toMatchObject({ code: "ENOENT" })
    const [countsAfterWebsiteSettlement] = queryDatabase<{
      rounds: number
      matches: number
      messages: number
    }>(
      state.databasePath,
      `select
        (select count(*) from debate_rounds where debate_job_id = ?) as rounds,
        (select count(*) from debate_matches match_count inner join debate_rounds round_count on round_count.debate_round_id = match_count.debate_round_id where round_count.debate_job_id = ?) as matches,
        (select count(*) from debate_messages message_count inner join debate_matches message_match on message_match.debate_match_id = message_count.debate_match_id inner join debate_rounds message_round on message_round.debate_round_id = message_match.debate_round_id where message_round.debate_job_id = ?) as messages`,
      created.debateJobId,
      created.debateJobId,
      created.debateJobId,
    )
    expect(countsAfterWebsiteSettlement).toEqual({
      rounds: verdictState.rounds,
      matches: verdictState.matches,
      messages: verdictState.messages,
    })
    expect(
      providerMessages([second], "provider-request", "llm:debate-judge"),
    ).toEqual([])
    expect(
      providerMessages(
        [second],
        "provider-request",
        "llm:create-idea-site",
      ),
    ).toHaveLength(1)
    await second.stop()

    const third = await startApi(state)
    const eventFeed = await openEventFeed(
      third,
      session.cookie,
      `/api/debate-jobs/${created.debateJobId}/events`,
    )
    const events = await eventFeed.readAll()
    expect(events.filter(({ type }) => type === "done")).toHaveLength(1)
    expect(await readFile(websitePath, "utf8")).toBe(settledWebsite.text)
    expect(
      providerMessages(
        [third],
        "provider-request",
        "llm:create-idea-site",
      ),
    ).toEqual([])
    expect(
      providerMessages([third], "provider-request", "llm:debate-judge"),
    ).toEqual([])
    const [completed] = queryDatabase<{
      status: string
      rounds: number
      matches: number
      messages: number
    }>(
      state.databasePath,
      `select status,
        (select count(*) from debate_rounds where debate_job_id = ?) as rounds,
        (select count(*) from debate_matches match_count inner join debate_rounds round_count on round_count.debate_round_id = match_count.debate_round_id where round_count.debate_job_id = ?) as matches,
        (select count(*) from debate_messages message_count inner join debate_matches message_match on message_match.debate_match_id = message_count.debate_match_id inner join debate_rounds message_round on message_round.debate_round_id = message_match.debate_round_id where message_round.debate_job_id = ?) as messages
       from debate_jobs where debate_job_id = ?`,
      created.debateJobId,
      created.debateJobId,
      created.debateJobId,
      created.debateJobId,
    )
    expect(completed).toEqual({
      status: "completed",
      rounds: verdictState.rounds,
      matches: verdictState.matches,
      messages: verdictState.messages,
    })
    expect(
      providerMessages(
        [first, second, third],
        "provider-request",
        "llm:debate-judge",
      ),
    ).toHaveLength(finalJudgeRequests)
    expect(
      providerMessages(
        [first, second, third],
        "provider-request",
        "llm:create-idea-site",
      ),
    ).toHaveLength(1)
    expectCreditsSettledExactlyOnce(
      state.databasePath,
      session.userId,
      session.credits,
    )
    expect(
      canonicalDebateSnapshot(state.databasePath, created.debateJobId),
    ).toEqual(controlSnapshot)
  })
})
