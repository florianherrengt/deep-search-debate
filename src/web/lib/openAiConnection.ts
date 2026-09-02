import z from "zod"

import { deleteJson, getJson, postJson } from "./api.ts"

export const openAiConnectionQueryKey = ["openai-connection"] as const

export const openAiConnectionSnapshotSchema = z.discriminatedUnion("status", [
  z.object({ status: z.literal("disconnected") }),
  z.object({
    status: z.literal("pending"),
    verificationUrl: z.url({ protocol: /^https$/ }).max(2_048),
    userCode: z.string().min(1).max(128),
    expiresAt: z.iso.datetime(),
  }),
  z.object({ status: z.literal("connected") }),
  z.object({
    status: z.literal("failed"),
    message: z.string().min(1),
  }),
])

export type OpenAiConnectionSnapshot = z.infer<
  typeof openAiConnectionSnapshotSchema
>

export function getOpenAiConnection(signal?: AbortSignal) {
  return getJson(
    "/api/openai-connection",
    openAiConnectionSnapshotSchema,
    signal,
  )
}

export function startOpenAiConnection() {
  return postJson(
    "/api/openai-connection/start",
    {},
    openAiConnectionSnapshotSchema,
  )
}

export function deleteOpenAiConnection() {
  return deleteJson(
    "/api/openai-connection",
    openAiConnectionSnapshotSchema,
  )
}
