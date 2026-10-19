import z from "zod"

const evidenceExcerptDescription = "Copy a concise, exact contiguous substring only from the raw source tags permitted for this stage: <original_request>, <prior_answers>, and/or <research_evidence>. Do not copy from derived <stage_context> or <stage_input>, even when it repeats source wording. This is evidence text, not a citation or link: do not append Markdown citations, titles, URLs, quotation marks, or change punctuation, casing, or typography."

export const refineIdParamsSchema = z.object({ id: z.uuid() })
export const refinePipelineCheckpointSchema = z.object({
  prepJobIds: z.record(z.string().regex(/^(0|[1-9][0-9]*)$/), z.uuid()),
  stageGenerationIds: z.record(z.string(), z.uuid()),
  stageOutputs: z.record(z.string(), z.unknown()),
  evidence: z.array(z.string()),
  targetedRequests: z.record(z.string().regex(/^(0|[1-9][0-9]*)$/), z.string()),
  currentPosition: z.number().int().nonnegative(),
}).strict()

export const createRefineSessionSchema = z.object({ prompt: z.string().trim().min(1).max(10_000) }).strict()
const refineAnswerInputSchema = z.object({
  questionId: z.uuid(),
  selectedCandidateIds: z.array(z.uuid()),
  text: z.string().max(10_000),
}).strict()
export const refineBatchMutationSchema = z.object({ batchId: z.uuid(), answers: z.array(refineAnswerInputSchema) }).strict()
export const refineRetryMutationSchema = z.object({ batchId: z.uuid() }).strict()

const candidateSchema = z.object({
  label: z.string().trim().min(1),
  action: z.string().trim().min(1),
  consequence: z.string().trim().min(1),
}).strict()

const refineStoredQuestionSchema = z.object({
  id: z.uuid(), prompt: z.string(), candidates: z.array(z.object({ id: z.uuid(), label: z.string() }).strict()),
}).loose()
const refineStoredAnswerSchema = z.object({
  questionId: z.uuid(), selectedCandidateIds: z.array(z.uuid()), text: z.string(), unanswered: z.boolean(),
}).strict()
export const refineStoredQuestionsSchema = z.array(refineStoredQuestionSchema)
export const refineStoredAnswersSchema = z.array(refineStoredAnswerSchema)
export const refineStoredDraftAnswersSchema = z.array(refineAnswerInputSchema)

export const refineQuestionBatchSchema = z.object({
  questions: z.array(z.object({
    question: z.string().trim().min(1),
    candidates: z.array(candidateSchema).min(1),
    needKeys: z.array(z.string().trim().min(1).describe("An existing open clarification need key from shared state; do not invent or use research/deferred/resolved needs." )).min(1)
      .describe("Only open clarification need keys from shared state that this question addresses."),
    decisionKeys: z.array(z.string().trim().min(1).describe("An existing decision key already linked to one of this question's selected needs; do not invent or attach unrelated decisions." )).min(1)
      .describe("Only decision keys linked from the selected needKeys; this must be a subset of their linked decisions."),
    evidenceRefs: z.array(z.string()).describe(evidenceExcerptDescription),
    known: z.string().trim().min(1),
    missing: z.string().trim().min(1),
    consequenceIfUnanswered: z.string().trim().min(1),
  }).strict()),
}).strict()

export const refineDecisionOutputSchema = z.object({
  decisions: z.array(z.object({ key: z.string().trim().min(1), text: z.string().trim().min(1), alternatives: z.array(z.string()), sourceRefs: z.array(z.string()).describe(evidenceExcerptDescription) }).strict()),
  needs: z.array(z.object({ key: z.string().trim().min(1), text: z.string().trim().min(1), route: z.enum(["research", "clarification", "defer"]), decisionKeys: z.array(z.string()), sourceRefs: z.array(z.string()).describe(evidenceExcerptDescription) }).strict()),
  assumptions: z.array(z.object({ key: z.string().trim().min(1), text: z.string().trim().min(1), consequence: z.string().trim().min(1), decisionKeys: z.array(z.string()), sourceRefs: z.array(z.string()).describe(evidenceExcerptDescription) }).strict()),
}).strict()

export const refineQuestionReviewSchema = z.object({
  approvedIndexes: z.array(z.number().int().nonnegative()),
  rejected: z.array(z.object({ index: z.number().int().nonnegative(), reason: z.string() }).strict()),
}).strict()
export const refineActionSchema = z.object({
  action: z.enum(["TOOL_WORK", "ASK_USER", "EXPLAIN_THEN_ASK", "PROCEED", "WAIT_FOR_USER"]),
  questionIndexes: z.array(z.number().int().nonnegative()),
  toolResearchRequests: z.array(z.object({ needIds: z.array(z.uuid()).min(1), request: z.string().trim().min(1) }).strict()),
  reason: z.string(),
}).strict().superRefine((action, context) => {
  const hasQuestions = action.questionIndexes.length > 0
  const hasResearch = action.toolResearchRequests.length > 0
  const contradictory = action.action === "TOOL_WORK"
    ? hasQuestions || !hasResearch
    : action.action === "ASK_USER" || action.action === "EXPLAIN_THEN_ASK"
      ? hasResearch
      : hasQuestions || hasResearch
  if (contradictory) context.addIssue({ code: "custom", path: ["action"], message: "Refine action conflicts with its question and research targets" })
})
export const refinePresentedQuestionsSchema = z.object({ questions: z.array(z.string().trim().min(1)) }).strict()

export const refineAssumptionReviewSchema = z.object({
  assumptions: z.array(z.object({ key: z.string().trim().min(1), text: z.string().trim().min(1), consequence: z.string().trim().min(1), decisionKeys: z.array(z.string()), status: z.enum(["active", "invalidated", "resolved"]), sourceRefs: z.array(z.string()).describe(evidenceExcerptDescription) }).strict()),
  needs: z.array(z.object({ key: z.string().trim().min(1), text: z.string().trim().min(1), route: z.enum(["research", "clarification", "defer"]), status: z.enum(["open", "resolved", "deferred", "invalidated"]), decisionKeys: z.array(z.string()), sourceRefs: z.array(z.string()).describe(evidenceExcerptDescription) }).strict()),
}).strict()

export const refineRecoverContextSchema = z.object({
  requirements: z.array(z.object({ key: z.string().trim().min(1), text: z.string().trim().min(1), status: z.enum(["confirmed", "unresolved", "conflict"]), affectsDecisionKeys: z.array(z.string()), sourceRefs: z.array(z.string()).describe(evidenceExcerptDescription) }).strict()),
  knownFacts: z.array(z.object({ key: z.string().trim().min(1), text: z.string().trim().min(1), sourceRefs: z.array(z.string()).describe(evidenceExcerptDescription) }).strict()),
  unresolved: z.array(z.string()),
}).strict()

export const refineResearchDomainSchema = z.object({
  domainMap: z.array(z.object({ key: z.string().trim().min(1), text: z.string().trim().min(1), decisionKeys: z.array(z.string()), sourceRefs: z.array(z.string()).describe(evidenceExcerptDescription) }).strict()),
  needs: z.array(z.object({ key: z.string().trim().min(1), text: z.string().trim().min(1), route: z.enum(["research", "clarification", "defer"]), decisionKeys: z.array(z.string()), sourceRefs: z.array(z.string()).describe(evidenceExcerptDescription) }).strict()),
}).strict()

export const refineIntegrateAnswersSchema = z.object({
  resolvedNeedKeys: z.array(z.string()),
  unresolvedNeedKeys: z.array(z.string()),
  invalidatedNeedKeys: z.array(z.string()),
  assumptionUpdates: z.array(z.object({ key: z.string(), status: z.enum(["active", "invalidated", "resolved"]), consequence: z.string() }).strict()),
  requirementUpdates: z.array(z.object({ key: z.string().trim().min(1), text: z.string().trim().min(1), status: z.enum(["confirmed", "unresolved", "conflict"]), affectsDecisionKeys: z.array(z.string()), sourceRefs: z.array(z.string()).describe(evidenceExcerptDescription) }).strict()),
  followUpWork: z.array(z.object({ needKey: z.string(), route: z.enum(["research", "clarification", "defer"]), reason: z.string() }).strict()),
}).strict()

/** Versioned records preserve provenance, dependencies, resolution, and invalidation. */
export const refineSharedStateSchema = z.object({
  version: z.literal(1),
  evidence: z.array(z.object({ id: z.string(), text: z.string(), source: z.string(), kind: z.enum(["user", "research"]) }).strict()),
  requirements: z.array(z.object({ id: z.string(), key: z.string(), text: z.string(), source: z.string(), status: z.enum(["confirmed", "unresolved", "conflict"]), affectsDecisionKeys: z.array(z.string()), affectsDecisionIds: z.array(z.string()) }).strict()),
  domainMap: z.array(z.object({ id: z.string(), key: z.string(), text: z.string(), source: z.string(), decisionKeys: z.array(z.string()), decisionIds: z.array(z.string()) }).strict()),
  decisions: z.array(z.object({ id: z.string(), key: z.string(), text: z.string(), alternatives: z.array(z.string()), source: z.string(), status: z.enum(["open", "resolved", "deferred"]), version: z.number().int().positive() }).strict()),
  needs: z.array(z.object({ id: z.string(), key: z.string(), text: z.string(), route: z.enum(["research", "clarification", "defer"]), status: z.enum(["open", "resolved", "deferred", "invalidated"]), source: z.string(), evidenceIds: z.array(z.string()), decisionKeys: z.array(z.string()), decisionIds: z.array(z.string()), version: z.number().int().positive() }).strict()),
  assumptions: z.array(z.object({ id: z.string(), key: z.string(), text: z.string(), consequence: z.string(), source: z.string(), status: z.enum(["active", "invalidated", "resolved"]), decisionKeys: z.array(z.string()), decisionIds: z.array(z.string()), version: z.number().int().positive() }).strict()),
  questions: z.array(z.object({ questionId: z.string(), needIds: z.array(z.string()), decisionIds: z.array(z.string()), status: z.enum(["pending", "answered", "unanswered", "superseded"]), source: z.string(), version: z.number().int().positive() }).strict()),
}).strict()

export type RefineAnswerInput = z.infer<typeof refineAnswerInputSchema>
export type RefineSharedState = z.infer<typeof refineSharedStateSchema>
