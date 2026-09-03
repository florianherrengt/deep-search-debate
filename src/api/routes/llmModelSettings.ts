import { zValidator } from "@hono/zod-validator"
import type { Hono } from "hono"

import {
  getLlmModelSettingsSnapshot,
  InvalidLlmModelAssignmentError,
  putLlmModelSettings,
} from "../llms/modelCatalog.ts"
import { replaceLlmModelSettingsInputSchema } from "../llms/modelSettings.ts"
import type { AppEnv } from "../types/auth.ts"

export function llmModelSettingsRoutes(app: Hono<AppEnv>): void {
  app.get("/llm-model-settings", async (c) =>
    c.json(await getLlmModelSettingsSnapshot(c.get("userId"))),
  )

  app.put(
    "/llm-model-settings",
    zValidator("json", replaceLlmModelSettingsInputSchema),
    async (c) => {
      try {
        return c.json(
          await putLlmModelSettings(
            c.get("userId"),
            c.req.valid("json").assignments,
          ),
        )
      } catch (error) {
        if (error instanceof InvalidLlmModelAssignmentError) {
          return c.json({ error: error.message }, 400)
        }
        throw error
      }
    },
  )
}
