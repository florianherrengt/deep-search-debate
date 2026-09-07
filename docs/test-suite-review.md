# Test-suite review — 7 September 2026

This review covers every test file present at the starting revision: 87 API
Vitest files, 54 web Vitest files, and seven Playwright specs. It evaluates
observable behavior and realistic regression protection; it does not use a
coverage percentage or target test count.

## Baseline and validation

The baseline was measured in an isolated checkout with Node 26.5.1 and the
existing lockfile. API Vitest ran 724 tests, all passing. Web Vitest ran 346
tests: 345 passed and the terminal-snapshot refetch case in `Debates.test.tsx`
failed during concurrent API/browser execution. The unchanged debate file
then passed all 31 tests alone. This is an observed load-sensitive test failure,
not evidence of a new production regression. All 15 baseline Playwright
scenarios passed.

The canonical suite therefore started at **1,070 tests**, with **15 additional
browser scenarios**. Final counts and checks are recorded below after the
completed edits.

## Architecture and test boundaries

- API Vitest applies the committed Drizzle migrations to real SQLite through
  `db/testSetup.ts`. Foreign keys and the actual queries, triggers, constraints,
  and transactions are exercised. It is the same SQL engine used in production.
- In-memory SQLite cannot prove WAL locking or process restart behavior.
  `researchCapacity.test.ts` retains its separate connections to file-backed
  SQLite, and `restartRecovery.test.ts` retains its migrated disposable database
  and real child processes.
- Browser E2E starts the real Hono API and Vite client. The existing preload
  controls external model, OAuth, search, and extraction responses and rejects
  unexpected outbound requests. App routes, queues, persistence, replay, and UI
  remain real.
- Component integrations can stop at browser `fetch` while retaining the real
  application client, schema parsing, stream reader, hook, and rendered component.
  This boundary is stronger than replacing the application's own client with an
  already-parsed value.

## Deliberately retained repetition

- Ownership SQL scopes and HTTP authorization both remain: a correct predicate
  does not prove that a route applies it or avoids disclosing private data.
- Schema constraints, application transactions, and lifecycle coordinators
  remain separately tested. Each can fail independently, including during a
  cancellation or completion race.
- Credit arithmetic, atomic settlement, and stale-callback protection retain
  their distinct cases. A successful balance update does not prove that a
  duplicate callback cannot charge twice.
- Stop, ordinary failure, interruption, replay, and restart recovery remain
  distinct. They produce different durable states and determine which work may
  be reused.
- Both complete DeepSeek and OpenAI debate browser scenarios remain. The OpenAI
  path has a different transport, strict-schema restriction, model/effort routing,
  credential lifecycle, and zero-product-credit accounting. Previous OpenAI
  failures occurred after the early stages, so an early-stage smoke test is
  insufficient.
- Prompt-context isolation, untrusted-output validation, malformed network
  payloads, and credential tampering remain explicit security tests.

## Architecture limitations and unresolved contracts

Some page and orchestration tests still replace internal clients or coordinators
to control precise failure timing. Their retained justification is the specific
race or failure boundary under test, with real-stack browser/process tests
providing complementary wiring proof. Replacing every seam would create large
fixtures and duplicate entire workflows without necessarily improving fault
detection. Import-time configuration and process-global queues also require
careful isolation and completion cleanup.

The visual border audit produced screenshots and findings but had no assertion
that its reported visual suspects were absent. A green diagnostic run did not
prove the claimed visual property. Existing asserting browser scenarios are the
source of automatic responsive and navigation regression protection.

There is an existing selection-policy discrepancy: the idea-job documentation
describes duplicate, unknown, or invalid selection counts as failures, while
the running implementation and its tests normalize those proposals. Search
selection similarly filters unknown/duplicate IDs and has a TODO to reject them.
This test-only review preserves current behavior and the existing regression
tests. Choosing a different policy requires a separate product decision and
coordinated production changes.

## Completed changes and final results

Seven old Vitest cases were removed after their useful guarantees were replaced:
three manually invoked structured-generation callback cases, two fixture-only
cases, one test-authored transcript-order query, and one fake-manager owner
forwarding case. Twelve behavior cases were added: six structured-generation
integrations, two real-manager creation cases, two streaming lifecycle cases,
one persisted recovery-order case, and one financial rejection case.

The API generation integrations use actual prompt loading, model selection,
provider reservation, Pi transport, SSE parsing, migrated SQLite, terminal
transactions, and account settlement. Only the external HTTP response is
controlled. They verify successful object/array hook writes, schema and prototype
rejection without billing, and rollback of hook writes and debits after failure.
A separate file is necessary because the older generation test-support module
hoists mocks for the entire file.

Creation tests now verify custom settings and authenticated ownership on actual
stored roots and children, then re-read them through a fresh route instance.
Their generator seam deliberately ends the downstream workload with a controlled
failure while managers and persistence remain real. These tests do not claim to
exercise the full provider transport or authentication middleware. The existing
browser E2Es already checked successful creation response metadata; they remain
the complete application proof. The idea test is isolated in a separate file
because its older route suite hoists an internal runner mock.

The transcript consolidation reads through production `loadDebateMatch()`
instead of specifying the ordering query in the test. Recovery inserts roots
with identical timestamps and verifies the production loader's stable ordering.
The credit failure test re-queries the unchanged account balance.

PageSummary now exercises the real browser client, NDJSON parser, replay logic,
hook, and rendered component. QuerySummary and RoundReview reuse the existing
Storybook provider seam instead of mocking internal modules; terminal states
still assert that no subscription opens. The Storybook preview test now requires
a router-dependent history story and a real resource link. The debate refetch
fixture retains its terminal response on every later read and awaits the React
update. Four deep-search replay tests wait for durable completion. Two intentional
scheduler barriers remain because their negative assertions must prove that
already-started work is still awaited.

| Suite | Original tests | Final tests | Final result |
|---|---:|---:|---|
| API Vitest | 724 | 729 | All passed; 89 files |
| Web Vitest | 346 | 346 | All passed; 53 files |
| Canonical total | **1,070** | **1,075** | **All passed** |
| Additional Playwright scenarios | 15 | 14 | All passed; six specs |

The final `npm run gatekeep` passed lint, TypeScript, Knip, and both complete
Vitest suites on the restored source. The complete Playwright suite passed in
3.2 minutes. Focused suites passed after each implementation batch and the
review corrections. Root, API, web, and database checklist reviews are clean.
The original load-sensitive debate test has been corrected and passes in the
full suite. No failing checks remain; production code, dependencies, migrations,
and runtime configuration are unchanged.

Three temporary production faults checked that representative strengthened
tests actually detect broken behavior:

| Temporary fault | Observed failure |
|---|---|
| Bypass stream completion hooks | All six structured-generation integrations failed: hook writes were skipped and invalid output or hook failures incorrectly completed. |
| Sort transcript by ID instead of position | Production transcript readback returned reversed positions and the ordering assertion failed. |
| Remove the Storybook router provider | The real history link could not render without router context and the preview test failed. |

Every fault was restored byte-for-byte before the final passing gate. These are
targeted fault checks, not a claim of exhaustive mutation coverage. The final
suite is five tests larger because the added cases address distinct behavioral
gaps; the count itself is not evidence of improvement.

## Complete file inventory

The table includes all 148 original files and the two added integration files.

| File | Disposition | Behavior or reason |
|---|---|---|
| `src/api/agents/deep_search/finalAnswer.test.ts` | Retained | Verifies the final-answer prompt/owner, registration failure, and bounded context. |
| `src/api/agents/deep_search/generateWebSearchQueries.test.ts` | Retained | Covers deduplication, previous-query exclusion, delimited prior evidence, callback normalization, error propagation, and bounds. |
| `src/api/agents/deep_search/querySummaries.test.ts` | Retained | Covers exact serialized result forwarding and registration errors. |
| `src/api/agents/deep_search/researchAnalysis.test.ts` | Retained | Covers prompt bounds, schema-constrained generation, malformed structured output, and unsafe URL rejection. |
| `src/api/agents/deep_search/reviewRound.test.ts` | Retained | Covers schema/prompt/owner, invalid reason handling, and bounded context. |
| `src/api/agents/deep_search/searchSummaryContext.test.ts` | Retained | Covers bounded allocation, equal distribution, redistribution, and minimum budget. |
| `src/api/agents/deep_search/selectWebSearchResults.test.ts` | Retained | Covers structured selection, safe untrusted JSON serialization, max limit, unknown/duplicate ID handling, callback normalization, empty input, and errors. |
| `src/api/agents/deep_search/summarizePage.test.ts` | Retained | Covers prompt/registration, extraction and summary, extraction failure without stream/charge, per-page isolation, summary registration failure, and terminal persistence failure. |
| `src/api/config.test.ts` | Retained | Broad environment/default, endpoint, production security, provider/key/model, quota, limit, and cross-limit coverage. |
| `src/api/credits.test.ts` | Strengthened | Invalid charges, grants, provider costs, and missing accounts leave the real account balance unchanged. |
| `src/api/db/recovery.test.ts` | Strengthened | Real persisted roots with equal timestamps recover in stable ID order; root filtering and failure behavior remain. |
| `src/api/db/schema/baselineMigration.test.ts` | Retained | Fresh real migration verifies tables, columns, foreign keys, triggers, constraints, `foreign_key_check`, and `integrity_check`. |
| `src/api/db/schema/cancellation.test.ts` | Retained | Directly verifies root-only cancellation persistence and running/interrupted semantics. |
| `src/api/db/schema/cascadeDeletion.test.ts` | Retained | Real owned standalone-search and full debate/idea child cascade plus NO ACTION partial deletion protection. |
| `src/api/db/schema/debateJobs.test.ts` | Consolidated | Two test-authored ordering queries replaced by production transcript readback; equal timestamps, reversed IDs, and duplicate judge rejection remain. |
| `src/api/db/schema/integrityConstraints.test.ts` | Retained | The large real-DB matrix covers status, global slug uniqueness, ownership/immutability, ordered rounds, idea freeze, one-time lifecycle, selection validity, whitespace/nonblank durable inputs, terminal jobs, feedback, credits, query and page/result lifecycle, cross-job links, and indexes. |
| `src/api/db/schema/ownership.test.ts` | Retained | Global account uniqueness, cross-owner root/generation links, and timestamp defaults are focused ownership/security boundaries. |
| `src/api/drizzle.config.test.ts` | Retained | Narrow production path regression. |
| `src/api/e2e/restartRecovery.test.ts` | Retained | Five real child-process scenarios cover in-flight replacement, durable replay, automatic recovery, Resume deduplication, checkpoint reuse, verdict/website recovery, exact-once billing, and duplicate-call prevention. |
| `src/api/helpers/addAbortableQueueTask.test.ts` | Retained | Waiting abort, active permit release after cleanup, and priority prove queue/concurrency ownership. |
| `src/api/helpers/promptTitles.test.ts` | Retained | Slugification, non-English/numeric probing, suffixes, and title limits are complete utility boundaries; no consolidation needed. |
| `src/api/helpers/replayableEventLog.test.ts` | Retained | Real closed replay and live fan-out are the essential contract. |
| `src/api/index.test.ts` | Retained | Real app-level route contract and security coverage includes ping/health, intentional errors, provider log redaction, safe Codex errors, asset caching, auth visibility, anonymous creation, operation auth, feedback/origin, debug sign-in, cross-site mutation, hidden generic auth, and protected debug sessions. |
| `src/api/llms/costs/deepseekV4Flash.test.ts` | Retained | Financial rates, mixed costs, ceiling, incomplete usage, and negatives are covered. |
| `src/api/llms/costs/index.test.ts` | Retained | Fixed Zen cost, Pro pricing, and unpriced-model behavior are distinct catalog/financial rules. |
| `src/api/llms/debatePrompts.test.ts` | Retained | Static prompt constraints and untrusted delimiters are prompt-injection regressions. |
| `src/api/llms/generateText.structured.test.ts` | Consolidated | Three manually invoked callback tests replaced by real generation/SQLite integration; Codex URI, URL, schema, redaction, and transport safeguards remain. |
| `src/api/llms/generateText.text.test.ts` | Retained | Queued abort, provider metadata/credits, startup cleanup, role snapshots, hooks, processwide queue, and same-user Codex waiter behavior prove orchestration/concurrency. |
| `src/api/llms/generateText.title.test.ts` | Retained | Selected Small role, durable failure, and title schema are a distinct title-generation contract. |
| `src/api/llms/ideaPrompts.test.ts` | Retained | Idea-stage prompt and delimiter/security rules are independently named and useful on failure. |
| `src/api/llms/modelCatalog.test.ts` | Retained | Provider discovery, pricing/availability, exact OpenAI recommendation, transactional assignment validation, and redaction are durable settings/security behavior. |
| `src/api/llms/modelSettings.test.ts` | Retained | Real SQLite exhaustive PromptName role mapping, defaults, replacement, same-transaction OpenAI requirement, and disconnect atomicity. |
| `src/api/llms/piGeneration.test.ts` | Retained | Real Pi provider boundaries with fake network/runtime cover inactivity/timeout timers, reasoning/title/JSON options, tool behavior, finish/usage normalization, server/Codex classification, abort, and long-running content. |
| `src/api/llms/promptTitle.test.ts` | Retained | Tiny title prompt contract; no action. |
| `src/api/llms/provider.test.ts` | Retained | Provider construction, reasoning, exact OpenAI selection, explicit DeepSeek while connected, and safe explicit-vs-implicit fallback behavior are provider security contracts. |
| `src/api/llms/streams.test.ts` | Retained | Real SQLite stream registration, replay/fan-out, terminal CAS, hooks, credit settlement, metadata, finish/error/empty/malformed output, registration-before-provider, unknown stream, abort/interruption races, parent stop, cleanup failure, and DB-only replay. |
| `src/api/openaiConnection/codexGeneration.test.ts` | Retained | Exact model/effort listing, connection/auth behavior, explicit invalid protocol errors, implicit fallback, one-shot reservations, same-user serialization, aborted waiters, and independent users. |
| `src/api/openaiConnection/connectionManager.test.ts` | Retained | OAuth device flow, URL validation, global active-login lock/429, persistence, upstream redaction, timeout, disconnect abort, and late-write protection. |
| `src/api/openaiConnection/credentialCipher.test.ts` | Retained | AES-GCM random nonce roundtrip, tampering, and wrong identity. |
| `src/api/openaiConnection/credentialsRepository.test.ts` | Retained | Real SQLite encrypted storage, plaintext absence, CAS refresh, stale/disconnected behavior, and disconnect with corrupt credentials. |
| `src/api/openaiConnection/piCredentials.test.ts` | Retained | Buffer wiping on read/write, CAS refresh, no-write modifiers, deletion, unsupported records, and per-user serialization. |
| `src/api/publicDebatePage.test.ts` | Retained | Public escaped metadata, canonical/trailing-slash behavior, no-store, and private/unknown/malformed non-leakage are security/SEO contract cases. |
| `src/api/routes/credits.test.ts` | Retained | Covers admin access, normalization, revocation, listing, and a real balance increment; billing/admin mutation semantics remain distinct. |
| `src/api/routes/debates/context.test.ts` | Retained | Protects advocate-versus-judge prompt isolation, owned-child position lookup, and aggregate character bounds. |
| `src/api/routes/debates/index.test.ts` | Strengthened | Real manager creation persists the owner and custom configuration on the debate aggregate, then reads it back through the route. |
| `src/api/routes/debates/jobLifecycle.test.ts` | Retained | Protects the transactional final-verdict versus Stop race and root-only reopen/stale-attempt behavior. |
| `src/api/routes/debates/manager.test.ts` | Retained | Covers retry ownership, persisted recovery, no-controller Stop settlement, live Stop waiting, and Resume deduplication. |
| `src/api/routes/debates/persistence.test.ts` | Retained | SQLite integrity coverage includes same-owner links, counts, prerequisites, replay idempotency, Stop guards, generation ownership/replacement, and verdict rollback. |
| `src/api/routes/debates/run.test.ts` | Retained | Covers whitespace output, bounded retries, finish metadata, final-verdict publication, website failure, and user Stop event semantics. |
| `src/api/routes/debates/snapshot.test.ts` | Retained | Protects snapshot derivation, judge-JSON exclusion, website readiness, stage gating, failed-message exclusion, and Stop projection. |
| `src/api/routes/debates/tournament.test.ts` | Retained | Protects the tournament format, feasible non-repeating Swiss pairings, malformed-state rejection, standings/Elo tie-breakers, and knockout pairings. |
| `src/api/routes/debug.test.ts` | Retained | Covers the debug-user gate, search/extract projections, sanitized provider errors, and URL validation. |
| `src/api/routes/deepSearch/index.test.ts` | Strengthened | Four replay tests wait for the specific durable terminal row before reading events instead of assuming one timer tick is enough. |
| `src/api/routes/deepSearch/jobLifecycle.test.ts` | Retained | Protects atomic final-generation/job completion, promotion prerequisites, failure settlement, and owner/status checks. |
| `src/api/routes/deepSearch/manager.test.ts` | Retained | Covers workload guards, recovery/reopen, effective-root Stop, capacity, queue concurrency/priority, fallback, title/slug allocation, and retained live logs. |
| `src/api/routes/deepSearch/pipeline.test.ts` | Retained | Its orchestration matrix covers stage persistence/publication, empty results, limits, retries, stable IDs, deduplication, adaptive rounds, fallback, fan-out failures, and checkpoint resume. |
| `src/api/routes/deepSearch/replay.test.ts` | Retained | Verifies validated research-analysis reconstruction and omission of malformed structured output. |
| `src/api/routes/deepSearch/resourceLimits.test.ts` | Retained | Protects hard search, round, request, idea, and page ceilings at the schema boundary. |
| `src/api/routes/deepSearch/run.test.ts` | Retained | Protects the wrapper contract for final text, exactly one done event, fatal errors, and the Stop suffix. |
| `src/api/routes/deepSearch/store.test.ts` | Retained | Covers normalized-DB persistence, ownership, retry, selection, extraction, and transaction invariants. |
| `src/api/routes/examples/index.test.ts` | Retained | A compact fixture covers configured order, missing/private/running/public rows, plus the empty-configuration path. |
| `src/api/routes/ideas/ideaSites.test.ts` | Retained | Protects website path/readback, optional screenshots, screenshot failure degradation, durable-generation restore, and stale-winner replacement. |
| `src/api/routes/ideas/index.test.ts` | Retained | Covers route/manager limits and admission, history, Stop/Resume, replay, visibility/access, and website/screenshot reads. |
| `src/api/routes/ideas/manager.test.ts` | Retained | Protects title/slug allocation, recovery, completed-child reuse, root Resume rejection, and live Stop/Resume deduplication. |
| `src/api/routes/ideas/replay.test.ts` | Retained | Protects stage-specific failures, normalized ideas/order, no-evaluation state, parallel child ordering, and child-position derivation. |
| `src/api/routes/ideas/run.test.ts` | Retained; clarified | Intentional scheduler barriers remain for negative settle-all assertions; current selection-normalization policy is preserved. |
| `src/api/routes/ideas/schemas.test.ts` | Retained | Provides a focused schema guard for idea fields, bounds, and distinctness. |
| `src/api/routes/llmModelSettings.test.ts` | Retained | Covers effective catalog/assignments, full replacement, strict body rejection, and unavailable exact tuples. |
| `src/api/routes/openAiConnection.test.ts` | Retained | Covers connection snapshots, start/body validation, and disconnect without credential hydration. |
| `src/api/routes/ownership.test.ts` | Consolidated | Fake-manager owner-forwarding case replaced by actual persisted creation; access, revocation, public descendants, and private history safeguards remain. |
| `src/api/routes/readAccess.test.ts` | Retained | Protects owner/private/inherited-public and standalone resource/generation scopes plus collection filtering. |
| `src/api/routes/replayStateIntegration.test.ts` | Retained | Preserves restart interruption, completed-child-before-ancestor-Stop, ordinary failure, and direct Stop suffixes for deep-search and idea jobs. |
| `src/api/routes/researchCancellation.test.ts` | Retained | Covers durable Stop idempotence, owner scope, root/child guards, terminal distinction, and effective-root propagation. |
| `src/api/routes/researchCapacity.test.ts` | Retained | Real WAL contention covers slug allocation/transaction behavior; other cases protect historical quota writes, active capacity, and partial indexes. |
| `src/api/routes/resultFeedback.test.ts` | Retained | A parameterized suite covers all aggregate routes, rating changes, negative-text rules/limits, owner projection, running-state authority, and disclosure safety. |
| `src/api/routes/runCredits.test.ts` | Retained | Verifies independent charges and completed-owner-only totals across deep-search, idea, and debate projections. |
| `src/api/routes/seo.test.ts` | Retained | Covers public SEO/visibility states, robots/sitemap order and encoding, canonical metadata, noindex, nested resources, and JSON-LD safety. |
| `src/api/routes/streams.test.ts` | Retained | Covers create/Location, prompt boundaries, per-user admission, NDJSON follow/replay, and unknown/malformed IDs. |
| `src/api/routes/waitlist.test.ts` | Retained | Uses the real app/origin path to cover normalized persistence, duplicate idempotency, invalid input, and cross-site rejection. |
| `src/api/web_search/boundedFetch.test.ts` | Retained | Header and streamed response-size caps plus empty response are resource/security boundaries. |
| `src/api/web_search/index.test.ts` | Retained | Thin real dispatch/balance/signal contract. |
| `src/api/web_search/scrapingAnt.test.ts` | Retained | Real client with fake fetch covers processwide concurrency, request modes/headers, credits, HTTP/size/transport errors, request and queue timeouts, abort, and cleanup. |
| `src/api/web_search/searxng.test.ts` | Retained | Core-backed mapping, filtering, URL normalization, category/base URL, non-OK, malformed, missing, and empty responses. |
| `src/api/web_search/serper.test.ts` | Retained | Real Response parsing, request key/body, dedupe/normalization, empty/malformed/non-OK errors, and rate-limit handling. |
| `src/api/web_search/types.test.ts` | Retained | Text/count bounds and canonical URL first-ranked dedup are pure normalization invariants. |
| `src/api/web_search/webExtract.test.ts` | Retained | Real extraction fallback and PDF path, binary rejection, soft-error escalation, dual failure logging, and per-attempt credits metadata. |
| `src/api/workflowRuntime.test.ts` | Retained | Covers Effect success, tagged failure/interruption identity, defect wrapping, and debate-to-idea-to-deep-search parent-Stop classification. |
| `src/web/.storybook/preview.test.tsx` | Strengthened | Router-dependent automated-history story must render its heading and actual resource link, replacing a negative-only assertion. |
| `src/web/App.test.tsx` | Retained | Authentication, hidden sign-in, public/private routes, metadata, focus, menus, not-found, and account presentation. |
| `src/web/components/ExternalLink.test.tsx` | Retained | Verifies internal/external hrefs, new-tab safety attributes, accessible icon hiding, button variant, and inherited color. |
| `src/web/components/JobStatusBadge.test.tsx` | Retained | Distinct running, stopping, stopped, and interrupted presentation; no extra map-only cases added. |
| `src/web/components/MarkdownText.test.tsx` | Retained | Structure and link-target behavior are meaningful. |
| `src/web/components/RequestError.test.tsx` | Retained | Protects 404 navigation, safe generic messages, retry action, malformed JSON handling, and the allowlisted OpenAI error vocabulary. |
| `src/web/components/ResultFeedback.test.tsx` | Retained | Strong async behavior coverage: saved negative rating, draft preservation, trim/validation, save-only close, error retention, and localized cost. |
| `src/web/components/ResumeWorkflowControl.test.tsx` | Retained | Accessible action, pending state, visibility, and public callback contract retained. |
| `src/web/components/StopWorkflowControl.test.tsx` | Retained | Confirmation copy, pending/stopping safety, and reopening behavior protect a destructive workflow action. |
| `src/web/components/streaming/TextStreamOutput.test.tsx` | Retained | Covers live-region semantics, reduced motion, hidden structured output, errors, and Markdown/list rendering. |
| `src/web/components/waitlist/Waitlist.test.tsx` | Retained | Verifies valid submit through the UI and preserving entered email after server failure; the network client has separate boundary tests. |
| `src/web/e2e/appShell.spec.ts` | Retained | Real route/UI proof for responsive layout, dark theme, keyboard focus, menus, history navigation, and credit display. |
| `src/web/e2e/auth.spec.ts` | Retained | Anonymous mobile waitlist submission and hidden sign-in/debug auth behavior are true browser contracts. |
| `src/web/e2e/borderAudit.spec.ts` | Removed | Diagnostic generated screenshots/findings without failing on visual suspects; asserting workflow, navigation, and responsive E2Es remain. |
| `src/web/e2e/debates.spec.ts` | Retained | Real API/SQLite/orchestration/NDJSON/browser proof for 23-match completion, reload, publication/privacy, feedback, winner site, stop cascade, retry exhaustion, and rejection of unexpected outbound calls. |
| `src/web/e2e/deepSearch.spec.ts` | Retained | Full real workflow proves concurrent search/text streams, analysis, selection, summaries, final answer, replay/reopen, metadata, and stop reconstruction with controlled external services. |
| `src/web/e2e/ideas.spec.ts` | Retained | Full real workflow proves researched idea generation, child searches, refined ideas, final assessments, persistence/replay, stop cascade, and terminal cleanup. |
| `src/web/e2e/openAiConnection.spec.ts` | Retained | Full OpenAI connection and debate path, selected models/efforts, credential lifecycle, zero credits, terminal persistence, and winner site. |
| `src/web/lib/api.test.ts` | Retained | High-value transport/error security tests cover all JSON verbs and NDJSON initial responses, allowlisted codes, secret stripping, oversized codes, and delete validation. |
| `src/web/lib/debateJobs.test.ts` | Retained | Validates create/detail/events/history/update contracts, Date conversion, URL encoding, malformed payloads, and malformed credit/timestamp data. |
| `src/web/lib/deepSearchJobs.test.ts` | Retained | Broad event union and snapshot validation, unsafe source URL rejection, history/origin parsing, malformed credits/timestamps, and creation/subscription failures are important trust-boundary coverage. |
| `src/web/lib/deepSearchState.test.ts` | Retained | The multi-round event sequence proves keyed state preservation, optional review failure, and idempotent stop terminal semantics. |
| `src/web/lib/examples.test.ts` | Retained | Small network boundary with API-order preservation and malformed UUID rejection. |
| `src/web/lib/ideaJobs.test.ts` | Retained | Date conversion, inherited public visibility, malformed credit, and malformed timestamp checks are durable browser trust contracts. |
| `src/web/lib/llmModelSettings.test.ts` | Retained | Provider-labelled model/reasoning schema and authenticated read/write request shape are covered without UI coupling. |
| `src/web/lib/openAiConnection.test.ts` | Retained | Covers all connection states, rejects non-HTTPS pending URLs, and checks authenticated endpoint methods. |
| `src/web/lib/promptPresentation.test.ts` | Retained | The two tests protect normalization and the exact excerpt length/ellipsis boundary. |
| `src/web/lib/queryClient.test.ts` | Retained | Retry policy distinguishes permanent, transient, malformed, and finite-cap cases and verifies installation. |
| `src/web/lib/replayStream.test.ts` | Retained | High-value replay contract: reset before replay, permanent failure, malformed complete frame, truncated frame retry, and cancellation stale-event suppression. |
| `src/web/lib/researchCancellation.test.ts` | Retained | Parameterized endpoint/encoding coverage plus invalid success payload. |
| `src/web/lib/researchResumption.test.ts` | Retained | Parameterized endpoint/encoding coverage plus invalid success payload. |
| `src/web/lib/resultFeedback.test.ts` | Retained | Fetch-level resource routing, trim/empty validation, and malformed response rejection are complementary to the UI tests. |
| `src/web/lib/seo.test.tsx` | Retained | Strong metadata security/SEO coverage: noindex, canonical encoding, server metadata preservation/replacement, JSON-LD replacement, and description normalization. |
| `src/web/lib/textStreams.test.ts` | Retained | Real NDJSON subscriber covers stream event parsing, errors, malformed payloads, and read-boundary reassembly. |
| `src/web/lib/waitlist.test.ts` | Retained | Fetch-level email normalization, input rejection before network, and malformed response rejection. |
| `src/web/pages/AdminCredits/AdminCredits.test.tsx` | Retained | Private admin-page metadata; account mutation and permissions also tested through the API. |
| `src/web/pages/Debates/Debates.test.tsx` | Strengthened | Terminal refetch is synchronized and all later snapshot reads retain the same terminal result; stale-error and lifecycle assertions remain. |
| `src/web/pages/Debates/components/DebateMatchDetail.test.tsx` | Retained | Adjacent navigation names and direction semantics are specific accessibility/URL behavior. |
| `src/web/pages/Debates/components/DebatePromptForm.test.tsx` | Retained | Form normalization, defaults, disclosure, and submission contract retained. |
| `src/web/pages/Debates/components/DebateTranscript.test.tsx` | Retained | Protects layout flow, role labels, hiding structured judge output, and concurrent independent agent streams. |
| `src/web/pages/Debates/components/DebateView.stories.test.tsx` | Retained | Story composition tests completed feedback/prompt/winner and website-progress states that are easy to regress visually. |
| `src/web/pages/Debates/components/DebateVisibilityControls.test.tsx` | Retained | Publishing restrictions, clipboard success/failure race, pending close protection, and error recovery are meaningful user behavior; callback assertions accompany visible dialogs. |
| `src/web/pages/Debates/components/TournamentBoard.test.tsx` | Retained | Covers semantic regions, active-only progress, ordering, accordion state across live snapshots, terminal match state, knockout rendering, ratings presentation, and links. |
| `src/web/pages/Debates/components/WinnerIdeaCard.test.tsx` | Retained | The screenshot/text fallback and generated-site URLs are distinct output contracts. |
| `src/web/pages/Debates/debateSelectors.test.ts` | Retained | Pure selector tests protect progress/latest-round/winner, no premature closest alternative, and routed adjacent-match lookup. |
| `src/web/pages/DeepSearch/DeepSearch.stories.test.tsx` | Retained | Verifies both history tabs and selection state through composed Storybook stories. |
| `src/web/pages/DeepSearch/DeepSearch.test.tsx` | Retained | Creation, Stop/Resume, independent streams, history origin, replay, failure, not-found, and metadata. |
| `src/web/pages/DeepSearch/components/DeepSearchOverview.test.tsx` | Retained | Covers compact round links, focus stability, failure/stopped states, no premature round link, four analysis sections, and stop presentation. |
| `src/web/pages/DeepSearch/components/DeepSearchRoundDetail.test.tsx` | Retained | Direct URL encoding, round navigation, loading/not-found bounds, safe error text, partial work, and status distinctions are high-value. |
| `src/web/pages/DeepSearch/components/DeepSearchView.fixture.test.ts` | Removed | Only checked a Storybook fixture implementation; actual consumer tests cover visible success, failure, and stream completion. |
| `src/web/pages/DeepSearch/components/PageSummary.test.tsx` | Strengthened | Real fetch/NDJSON/replay/hook/component path proves partial output, completion, reconnect, abort/stale-event isolation, and retained findings on failure. |
| `src/web/pages/DeepSearch/components/QuerySummary.test.tsx` | Strengthened | Uses the existing preview-provider seam instead of a module mock; retains rendered synthesis, reasoning disclosure, and empty-state behavior. |
| `src/web/pages/DeepSearch/components/RoundReview.test.tsx` | Strengthened | Uses the existing provider seam; preserves streamed reasoning, continue/stop decisions, and optional-review failure presentation. |
| `src/web/pages/Examples/Examples.test.tsx` | Retained | API-order links and empty state are useful; replace the own `examples` client mock with a fetch-level response or leave this thin page test only if E2E covers the route. |
| `src/web/pages/Home/Home.test.tsx` | Retained | Three focused cases protect public waitlist hierarchy, authenticated compact hierarchy, and URL handoff. |
| `src/web/pages/Ideas/Ideas.test.tsx` | Retained | Partial pipeline and failure attribution, Stop/Resume, stable selection, metadata, routing, replay, and history. |
| `src/web/pages/Ideas/components/ProgressCard.test.tsx` | Retained | Heading semantics, manual expansion persistence, and not-run explanation are compact component contracts. |
| `src/web/pages/Ideas/ideaJobState.test.ts` | Retained | Reducer/presentation cases protect stable IDs, duplicate stop replay, final/provisional distinction, partial failure attribution, and stage ordering. |
| `src/web/pages/Settings/Settings.test.tsx` | Retained | Device authentication, disconnect confirmation, private metadata, exact model assignments, atomic save, and error preservation. |
| `src/web/theme.test.ts` | Retained | Theme and component-slot contracts retained alongside real browser dark-theme and accessibility checks. |
| `src/web/viteEnvironment.test.ts` | Retained | Covers defaults, worktree parsing, and invalid port rejection at the configuration boundary. |
| `src/api/llms/generateText.structured.integration.test.ts` | Added replacement integration | Real prompt/provider/SSE/SQLite path proves valid object and array hooks, schema/prototype rejection, billing, and transactional rollback. |
| `src/api/routes/ideas/creation.integration.test.ts` | Added replacement integration | Real route/managers/SQLite persist the owner and custom controls, settle a controlled downstream failure, and allow fresh route readback. |
