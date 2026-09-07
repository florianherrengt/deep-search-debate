---
id: 27
title: Fix Pi OpenAI URL schema compatibility
status: in-progress
priority: high
created: 2026-09-07T10:00:54.349529+01:00
updated: 2026-09-07T10:00:54.349529+01:00
tags:
    - bug
claimed_by: beneath-speed
claimed_at: 2026-09-07T10:00:54.349529+01:00
class: standard
---

Confirmed production HTTP 400 invalid_function_parameters: strict submit_structured_output schema includes unsupported format uri in research-analysis source URLs. Preserve Zod URL validation, adapt only the OpenAI provider schema, add regression coverage, validate, deploy and resume saved café debate 079f84b6-af55-4a46-b486-5b6445935ce6. User approved fixing this compatibility bug and resuming.
