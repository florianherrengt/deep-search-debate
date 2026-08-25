---
id: 17
title: Investigate AI SDK responseFormat JSON schema compatibility warning
status: in-progress
priority: medium
created: 2026-08-24T12:11:53.779676+01:00
updated: 2026-08-25T12:10:46.176398+01:00
started: 2026-08-25T11:26:09.368999+01:00
tags:
    - investigation
claimed_by: simlin-enjoying
claimed_at: 2026-08-25T12:10:46.176398+01:00
class: standard
---

Investigate this warning observed in the API logs:

  Warning: AI SDK Warning (deepseek.chat / deepseek-v4-flash): The feature "responseFormat JSON schema" is used in a compatibility mode. JSON response schema is injected into the system message.

Context: the provider is deepseek via @ai-sdk/deepseek (src/api/llms/provider.ts), which sets supportsStructuredOutputs: true. generateText.ts (loadStructuredPrompt) already has a fallback path that injects the JSON schema into the system message for providers without structured output support, so the SDK reporting compatibility mode suggests the model itself does not natively support the json_schema response format.

Determine: whether the warning is benign or signals double schema injection; whether supportsStructuredOutputs should be false for this model (and the zen transport comment in provider.ts already documents a similar case); whether a SDK/provider upgrade or different call option removes the warning. Verify structured outputs still validate and stream after any change (generateText/streams tests).

[[2026-08-25]] Tue 11:30
Investigation: reproduced the warning with a fake DeepSeek transport. The SDK sends response_format=json_object and injects the JSON schema once as a separate system message; the application does not inject a second copy while its current supportsStructuredOutputs flag is true. DeepSeek public docs list only text/json_object for response_format.

[[2026-08-25]] Tue 11:34
## Handoff
- Location: clean worktree /Users/florian/projects/deep-search-debate/.worktrees/codex-ticket-17-ai-sdk-response-format-warning on branch codex/ticket-17-ai-sdk-response-format-warning.
- Conclusion: the warning is expected compatibility behavior, not double schema injection. The DeepSeek adapter injects the schema once and sends response_format json_object. The application flag must remain true in its current role; setting it false alone would add a second schema instruction.
- Upgrade and options: installed ai 7.0.44 and @ai-sdk/deepseek 3.0.17; latest 7.0.79 and 3.0.32 retain the same path. strictJsonSchema does not enable native schema mode. No per-call option removes the warning; the global warning logger would only hide it.
- Official API evidence: https://api-docs.deepseek.com/guides/json_mode and https://api-docs.deepseek.com/api/create-chat-completion document json_object, not json_schema, for chat completions.
- Verification: npm run test -w @rethinkloop/api -- llms/provider.test.ts llms/generateText.test.ts llms/streams.test.ts routes/streams.test.ts passed 4 files and 49 tests.
- Files changed: none. No production change is recommended for this investigation-only ticket.

[[2026-08-25]] Tue 11:42
## Follow-up handoff
- Location: uncommitted change in /Users/florian/projects/deep-search-debate/.worktrees/codex-ticket-17-ai-sdk-response-format-warning on branch codex/ticket-17-ai-sdk-response-format-warning.
- Change: added a provider comment clarifying that the application flag assigns schema-instruction ownership to the DeepSeek adapter rather than asserting native json_schema support, and that false would duplicate the schema.
- File changed: src/api/llms/provider.ts.
- Verified: provider and generateText tests passed, 2 files and 17 tests; npm run typecheck passed; git diff --check passed.

[[2026-08-25]] Tue 11:58
Filtered only the expected DeepSeek AI SDK compatibility warning (responseFormat JSON schema / schema injected into system message) through provider-scoped middleware. Other warnings remain visible, and the request still sends response_format json_object. Added a regression test covering both properties. Full npm run gatekeep passed: lint, typecheck, knip, 612 API tests, and 299 web tests. Changes remain uncommitted in the ticket worktree.

[[2026-08-25]] Tue 12:07
## Follow-up handoff
- Worktree and branch: /Users/florian/projects/deep-search-debate/.worktrees/codex-ticket-17-ai-sdk-response-format-warning on codex/ticket-17-ai-sdk-response-format-warning.
- Production policy: provider initialization sets globalThis.AI_SDK_LOG_WARNINGS=false only when the typed config environment is production. Development/test warning logging remains unchanged, and warning objects remain available on AI SDK results.
- Existing behavior: the exact expected DeepSeek structured-output warning remains filtered at the model boundary; unrelated warnings remain programmatically visible.
- Files changed: src/api/llms/provider.ts and src/api/llms/provider.test.ts.
- Verified: focused provider tests passed 5/5; full npm run gatekeep passed lint, typecheck, knip, 614 API tests, and 299 web tests. The web suite still emits its unrelated Node localStorage ExperimentalWarning.
- Review notes: no new environment variable; reuses config.environment. Task code remains uncommitted.
