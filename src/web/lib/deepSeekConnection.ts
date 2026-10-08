import z from "zod"

import { deleteJson, getJson, putJson } from "./api.ts"

export const deepSeekConnectionQueryKey = ["deepseek-connection"] as const
const deepSeekConnectionSnapshotSchema = z.object({
  hasKey: z.boolean(),
})

export function getDeepSeekConnection(signal?: AbortSignal) {
  return getJson("/api/deepseek-connection", deepSeekConnectionSnapshotSchema, signal)
}

export function saveDeepSeekKey(apiKey: string) {
  return putJson(
    "/api/deepseek-connection",
    { apiKey },
    deepSeekConnectionSnapshotSchema,
  )
}

export function deleteDeepSeekKey() {
  return deleteJson("/api/deepseek-connection", deepSeekConnectionSnapshotSchema)
}
