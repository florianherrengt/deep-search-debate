---
id: 26
title: Use a small/big model depending on the task
status: backlog
priority: medium
created: 2026-08-25T14:35:37.286461+01:00
updated: 2026-08-25T14:35:37.286461+01:00
class: standard
---

Route LLM calls to a small (cheap/fast) or big (powerful) model per task, instead of one global model for everything. Related: #25 user-supplied providers; #23 budget per run.

## Repository context (from 2026-08-25 session investigation)

### Current behaviour (evidence)
- Exactly one model is configured process-wide: LLM_MODEL_NAME is required and validated in src/api/config.ts (superRefine: LLM_PROVIDER=deepseek allows only deepseek-v4-flash or deepseek-v4-pro, config.ts:440-451). LlmConfig carries a single model field (config.ts:574-585).
- Both deepseek-v4-flash AND deepseek-v4-pro already have credit pricing functions in src/api/llms/costs/deepseekV4Flash.ts, selected by modelId in calculateLlmCredits (src/api/llms/costs/index.ts) — flash (cheap) and pro (expensive) are both priceable today, but only one is reachable via env.
- Every generation goes through src/api/llms/generateText.ts (generateTextStream, generateArrayStream, generateObjectStream, generatePromptTitle). A model?: string param exists but is documented as an internal-only override that must stay aligned with the pricing function (generateText.ts:29-32); no production call site passes it (verified: only tests do).
- Call sites that would need routing: src/api/agents/deep_search/*.ts (queries, selection, summaries, reviewRound, researchAnalysis, finalAnswer, querySummaries), src/api/routes/ideas/run.ts (7 call sites), src/api/routes/debates/run.ts, src/api/routes/ideas/ideaSites.ts, src/api/routes/streams.ts (standalone streams), generatePromptTitle (short title, maxOutputTokens 50).
- Per-call reasoning is already toggled: LlmCallReasoning enabled/disabled (src/api/llms/provider.ts); evidence-transformation and prose stages disable reasoning (runtime.md). Reasoning policy is orthogonal to model choice today.
- PromptName enum (src/api/llms/prompts.ts:9-28) names every stage and is persisted on llm_generations — a natural task-complexity signal for routing.
- Costing is model-ID-keyed: calculateLlmCredits throws for unknown modelIds (costs/index.ts:24); zen provider is a flat 1 credit per generation (no small/big distinction there).
- provider.test.ts and costs/index.test.ts already cover per-model behavior for both deepseek models.

### Open questions (resolve before design)
1. Mapping policy: which tasks go to which model — per PromptName, per reasoning flag, per stage, or explicit at each call site?
2. Config shape: second env var (e.g. LLM_MODEL_NAME_SMALL/BIG) vs an array; validation rules like the existing deepseek model allow-list; zen has no big/small split (flat 1 credit) — does routing apply there?
3. Does the big model apply only to reasoning-enabled calls, or also to structured-output stages that currently disable reasoning?
4. Interaction with #25: do user-supplied providers get the same small/big routing?
5. Does the internal model override stay internal-only, or does routing become an explicit per-call parameter on GenerateStreamInput?
