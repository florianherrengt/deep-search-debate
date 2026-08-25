---
id: 17
title: Investigate AI SDK responseFormat JSON schema compatibility warning
status: backlog
priority: medium
created: 2026-08-24T12:11:53.779676+01:00
updated: 2026-08-24T12:11:53.779676+01:00
tags:
    - investigation
class: standard
---

Investigate this warning observed in the API logs:

  Warning: AI SDK Warning (deepseek.chat / deepseek-v4-flash): The feature "responseFormat JSON schema" is used in a compatibility mode. JSON response schema is injected into the system message.

Context: the provider is deepseek via @ai-sdk/deepseek (src/api/llms/provider.ts), which sets supportsStructuredOutputs: true. generateText.ts (loadStructuredPrompt) already has a fallback path that injects the JSON schema into the system message for providers without structured output support, so the SDK reporting compatibility mode suggests the model itself does not natively support the json_schema response format.

Determine: whether the warning is benign or signals double schema injection; whether supportsStructuredOutputs should be false for this model (and the zen transport comment in provider.ts already documents a similar case); whether a SDK/provider upgrade or different call option removes the warning. Verify structured outputs still validate and stream after any change (generateText/streams tests).
