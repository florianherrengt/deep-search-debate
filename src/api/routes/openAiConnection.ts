import { zValidator } from "@hono/zod-validator"
import type { Hono } from "hono"
import z from "zod"

import {
  disconnectOpenAiConnection,
  getOpenAiConnectionSnapshot,
  startOpenAiConnection,
} from "../openaiConnection/connectionManager.ts"
import type { AppEnv } from "../types/auth.ts"

const emptyBodySchema = z.object({}).strict()

export function openAiConnectionRoutes(app: Hono<AppEnv>): void {
  app.get("/openai-connection", (c) =>
    c.json(getOpenAiConnectionSnapshot(c.get("userId"))),
  )

  app.post(
    "/openai-connection/start",
    zValidator("json", emptyBodySchema),
    async (c) => c.json(await startOpenAiConnection(c.get("userId"))),
  )

  app.delete("/openai-connection", async (c) =>
    c.json(await disconnectOpenAiConnection(c.get("userId"))),
  )
}
