import { zValidator } from "@hono/zod-validator"
import type { Hono } from "hono"
import { HTTPException } from "hono/http-exception"
import type { AppEnv } from "../../types/auth.ts"
import {
  createRefineSessionSchema,
  refineBatchMutationSchema,
  refineIdParamsSchema,
  refineRetryMutationSchema,
} from "./schemas.ts"
import { RefineSessionError, type RefineSessionManager } from "./manager.ts"
import { modelSelectionRequiredError, needsModelSelection } from "../modelSelectionGuard.ts"

function respond<T>(operation: () => T) {
  try {
    return { value: operation() }
  } catch (error) {
    throw mapRefineError(error)
  }
}

async function respondAsync<T>(operation: () => Promise<T>) {
  try {
    return { value: await operation() }
  } catch (error) {
    throw mapRefineError(error)
  }
}

function mapRefineError(error: unknown): HTTPException {
  if (error instanceof HTTPException) return error
  if (error instanceof RefineSessionError) return new HTTPException(error.status, { message: error.message })
  if (error instanceof RangeError) return new HTTPException(413, { message: error.message })
  return new HTTPException(500, { message: "Refine request failed" })
}

/** Registers private, owner-scoped Refine sessions. Mount behind requireSession. */
export function refineSessions(app: Hono<AppEnv>, manager: RefineSessionManager) {
  app.get("/refine-sessions", (c) => c.json({ refineSessions: manager.list(c.get("userId")) }))

  app.post("/refine-sessions", zValidator("json", createRefineSessionSchema), (c) => {
    if (needsModelSelection(c.get("userId"))) return c.json(modelSelectionRequiredError, 409)
    const result = respond(() => manager.create(c.get("userId"), c.req.valid("json").prompt))
    return c.json({ refineSession: result.value }, 202)
  })

  app.get("/refine-sessions/:id", zValidator("param", refineIdParamsSchema), (c) => {
    const result = respond(() => manager.get(c.get("userId"), c.req.valid("param").id))
    if (!result.value) return c.json({ error: "Refine session not found" }, 404)
    return c.json({ refineSession: result.value })
  })

  app.put("/refine-sessions/:id/draft", zValidator("param", refineIdParamsSchema), zValidator("json", refineBatchMutationSchema), (c) => {
    const { id } = c.req.valid("param")
    const body = c.req.valid("json")
    const result = respond(() => manager.saveDraft(c.get("userId"), id, body.batchId, body.answers))
    return c.json({ refineSession: result.value })
  })

  app.post("/refine-sessions/:id/batches", zValidator("param", refineIdParamsSchema), zValidator("json", refineBatchMutationSchema), (c) => {
    if (needsModelSelection(c.get("userId"))) return c.json(modelSelectionRequiredError, 409)
    const { id } = c.req.valid("param")
    const body = c.req.valid("json")
    const result = respond(() => manager.askMore(c.get("userId"), id, body.batchId, body.answers))
    return c.json({ refineSession: result.value }, 202)
  })

  app.post("/refine-sessions/:id/retry", zValidator("param", refineIdParamsSchema), zValidator("json", refineRetryMutationSchema), (c) => {
    if (needsModelSelection(c.get("userId"))) return c.json(modelSelectionRequiredError, 409)
    const { id } = c.req.valid("param")
    const result = respond(() => manager.retry(c.get("userId"), id, c.req.valid("json").batchId))
    return c.json({ refineSession: result.value }, 202)
  })

  app.post("/refine-sessions/:id/research", zValidator("param", refineIdParamsSchema), zValidator("json", refineBatchMutationSchema), async (c) => {
    if (needsModelSelection(c.get("userId"))) return c.json(modelSelectionRequiredError, 409)
    const { id } = c.req.valid("param")
    const body = c.req.valid("json")
    const result = await respondAsync(() => manager.startResearch(c.get("userId"), id, body.batchId, body.answers))
    return c.json({ refineSession: result.value })
  })
}
