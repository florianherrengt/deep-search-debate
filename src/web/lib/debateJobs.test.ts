import { afterEach, describe, expect, it, vi } from "vitest"
import {
  createDebateJob,
  getDebateJob,
  getDebateJobs,
  subscribeToDebateJob,
  type DebateJobEvent,
} from "./debateJobs.ts"

async function drain(
  events: AsyncGenerator<DebateJobEvent>,
): Promise<DebateJobEvent[]> {
  const result: DebateJobEvent[] = []
  for await (const event of events) result.push(event)
  return result
}

describe("debate jobs client", () => {
  afterEach(() => vi.unstubAllGlobals())

  it("creates a job, validates its snapshot, and follows updates", async () => {
    const snapshot = {
      debateJobId: "debate-id",
      ideaJobId: "idea-job-id",
      prompt: "Solve this problem",
      stage: "swiss",
      status: "running",
      expectedMatchCount: 33,
      rounds: [
        {
          debateRoundId: "round-id",
          stage: "swiss",
          stageRoundNumber: 1,
          matches: [
            {
              debateMatchId: "match-id",
              position: 0,
              firstIdea: {
                ideaId: "idea-a",
                position: 0,
                title: "Idea A",
                description: "First idea",
              },
              secondIdea: {
                ideaId: "idea-b",
                position: 1,
                title: "Idea B",
                description: "Second idea",
              },
              winnerIdeaId: null,
              status: "running",
              messages: [
                {
                  debateMessageId: "message-id",
                  position: 0,
                  speakerSlot: 0,
                  llmGenerationId: "generation-id",
                  text: "",
                  createdAt: "2026-08-04T12:00:00.000Z",
                },
              ],
            },
          ],
        },
      ],
      standings: [],
      error: null,
    }
    const events = [{ type: "updated" }, { type: "done" }] as const
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        Response.json({ debateJobId: "debate-id" }, { status: 202 }),
      )
      .mockResolvedValueOnce(Response.json({ debateJob: snapshot }))
      .mockResolvedValueOnce(
        new Response(events.map((event) => JSON.stringify(event)).join("\n"), {
          status: 200,
        }),
      )
    vi.stubGlobal("fetch", fetchMock)
    const onOpen = vi.fn()

    await expect(createDebateJob("Solve this problem")).resolves.toBe(
      "debate-id",
    )
    const job = await getDebateJob("debate-id")
    await expect(
      drain(subscribeToDebateJob("debate-id", undefined, onOpen)),
    ).resolves.toEqual(events)

    expect(job.rounds[0]?.matches[0]?.messages[0]?.createdAt).toEqual(
      new Date("2026-08-04T12:00:00.000Z"),
    )
    expect(fetchMock).toHaveBeenNthCalledWith(1, "/api/debate-jobs", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ prompt: "Solve this problem" }),
      signal: undefined,
    })
    expect(fetchMock).toHaveBeenNthCalledWith(
      2,
      "/api/debate-jobs/debate-id",
      { signal: undefined },
    )
    expect(fetchMock).toHaveBeenNthCalledWith(
      3,
      "/api/debate-jobs/debate-id/events",
      { signal: undefined },
    )
    expect(onOpen).toHaveBeenCalledOnce()
  })

  it("rejects malformed snapshots and events", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        Response.json({ debateJob: { debateJobId: "debate-id" } }),
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ type: "unknown" }), { status: 200 }),
      )
    vi.stubGlobal("fetch", fetchMock)

    await expect(getDebateJob("debate-id")).rejects.toThrow()
    await expect(drain(subscribeToDebateJob("debate-id"))).rejects.toThrow()
  })

  it("loads and validates durable debate history", async () => {
    const debateJobs = [
      {
        debateJobId: "debate-id",
        ideaJobId: "idea-job-id",
        prompt: "Solve this problem",
        stage: "final",
        status: "completed",
        error: null,
        createdAt: "2026-08-04T12:00:00.000Z",
        completedAt: "2026-08-04T12:30:00.000Z",
      },
    ]
    const fetchMock = vi.fn().mockResolvedValue(
      Response.json({ debateJobs }),
    )
    vi.stubGlobal("fetch", fetchMock)

    await expect(getDebateJobs()).resolves.toEqual([
      {
        ...debateJobs[0],
        createdAt: new Date(debateJobs[0].createdAt),
        completedAt: new Date(debateJobs[0].completedAt),
      },
    ])
    expect(fetchMock).toHaveBeenCalledWith("/api/debate-jobs", {
      signal: undefined,
    })
  })

  it("rejects malformed debate history timestamps", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        Response.json({
          debateJobs: [
            {
              debateJobId: "debate-id",
              ideaJobId: "idea-job-id",
              prompt: "Solve this problem",
              stage: "ideas",
              status: "running",
              error: null,
              createdAt: "yesterday",
              completedAt: null,
            },
          ],
        }),
      ),
    )

    await expect(getDebateJobs()).rejects.toThrow()
  })
})
