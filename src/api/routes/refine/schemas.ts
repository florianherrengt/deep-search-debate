import z from "zod"

const evidenceExcerptDescription = "Return only exact IDs from the supplied evidence excerpt catalog. Application code resolves valid IDs to canonical excerpt text before persistence."

export const refineIdParamsSchema = z.object({ id: z.uuid() })
export const refinePipelineCheckpointSchema = z.object({
  preparationJobId: z.uuid().optional(),
  stageGenerationIds: z.record(z.string(), z.uuid()),
  stageOutputs: z.record(z.string(), z.unknown()),
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

const refineGeneratedQuestionSchema = z.object({
    question: z.string().trim().min(1),
    candidates: z.array(candidateSchema).min(1),
    evidenceRefs: z.array(z.string()).describe(evidenceExcerptDescription),
}).strict()

export const refineQuestionBatchSchema = z.object({
  questions: z.array(refineGeneratedQuestionSchema).superRefine((questions, context) => {
    const seenQuestions = new Set<string>()
    questions.forEach((question, questionIndex) => {
      const normalizedQuestion = question.question.toLowerCase()
      if (seenQuestions.has(normalizedQuestion)) {
        context.addIssue({ code: "custom", path: [questionIndex, "question"], message: "Question text must be unique" })
      }
      seenQuestions.add(normalizedQuestion)

      const seenCandidates = new Set<string>()
      question.candidates.forEach((candidate, candidateIndex) => {
        const normalizedLabel = candidate.label.toLowerCase()
        if (seenCandidates.has(normalizedLabel)) {
          context.addIssue({ code: "custom", path: [questionIndex, "candidates", candidateIndex, "label"], message: "Candidate labels must be unique within a question" })
        }
        seenCandidates.add(normalizedLabel)
      })
    })
  }),
}).strict()

export type RefineAnswerInput = z.infer<typeof refineAnswerInputSchema>
