---
id: 32
title: 'Add llms.txt: site index plus per-page files for public content'
status: backlog
priority: medium
created: 2026-10-05T11:23:59.715568+01:00
updated: 2026-10-05T13:27:34.407083+01:00
tags:
    - seo
    - api
class: standard
---

GOAL
Expose RethinkLoop content to LLM crawlers via llms.txt (llmstxt.org): a site-level index plus per-page plain-markdown renditions of public content, e.g. /debates/:slug/llms.txt. Motivation: today crawlers get SPA HTML with injected head metadata only (resolveSeoPage / renderSeoDocument); page body content is client-rendered, so no crawlable full-text representation of any debate, idea, deep search, or generated website exists.

SCOPE (original intent; shaped by the decisions below)
1. GET /llms.txt - site index following the llmstxt.org format: title, blockquote summary, H2 sections per entity type linking public pages with one-line descriptions. Listing scope: see D1.
2. Per-page llms.txt for public entity routes: /debates/:slug/llms.txt, /ideas/:slug/llms.txt, /ideas/:slug/:ideaId/llms.txt, /deep-search/:slug/llms.txt - content per D2.
3. Child pages get their own files per D4; generated-idea-website rendition per D3.
4. Wire-up per D5/D6/D7.

CURRENT BEHAVIOUR (verified in code)
- src/api/routes/seo.ts registers crawler endpoints OUTSIDE the /api basePath: seoPages(app) is called at src/api/index.ts:109 and serves GET /robots.txt (robotsTxt()) and GET /sitemap.xml (sitemapXml()).
- sitemapXml(debateJobIds) builds paths from publicDebateSlugs / publicDeepSearchSlugs / publicIdeas (seo.ts lines 70-137). All three filter on debateJobs.isPublic = true AND debateJobs.status = 'completed'. SCOPING NUANCE: they only consider the debateJobIds passed into seoPages(app, debateJobIds = config.examples.debateIds) - i.e. the sitemap lists ONLY operator-curated EXAMPLE_DEBATE_IDS content plus / and /examples. README env docs state this selection deliberately controls sitemap promotion; an empty value leaves the examples page empty.
- Production serving: src/api/index.ts lines 144-185. When config.environment === 'production', the app serves the built SPA from ../web/dist via serveStatic, then a catch-all calls resolveSeoPage(path, viewerUserId); not-found returns notFoundHtml with 404 + X-Robots-Tag: noindex; found pages get renderSeoDocument(webIndex, metadata, pageKey) with Cache-Control: private, no-store. Body content is still client-rendered (prerendered head, not SSR). Head injection does NOT run in development.
- Visibility model: resolveSeoPage (seo.ts line 512) resolves per-route SeoMetadata. Public entity pages are indexable only when the root debate isPublic AND status completed; private resources resolve for their owner (viewerUserId) with noindex and null canonical; non-owners get not-found. API-side read scopes live in src/api/routes/readAccess.ts (debateJobReadScope, ideaJobReadScope, deepSearchJobReadScope).
- Public API read routes (optional session): GET /api/idea-jobs/:slug, GET /api/deep-search-jobs/:slug, GET /api/debate-jobs/:slug, GET /api/examples (exampleDebateReads in src/api/routes/examples/index.ts returns curated public completed debates).
- Generated idea websites: src/api/routes/ideas/ideaSites.ts stores one self-contained HTML page per winning idea at config.ideaSites.dir/<ideaId>/websites/index.html (env IDEA_SITES_DIR) plus screenshot.png. Served at GET /api/idea-jobs/:ideaJobId/ideas/:ideaId/website with Content-Security-Policy: sandbox allow-scripts (model output, untrusted), X-Content-Type-Options: nosniff, Cache-Control: no-store. Access: checkIdeaSiteAccess (ideas/index.ts line 55) via ideaJobReadScope. Generation: generateWinningIdeaSite / generateIdeaSite (PromptName.CreateIdeaSite); the HTML generation is linked from debateJobs.websiteGenerationId. The repair block (ideaSites.ts:265-276) only rewrites index.html/screenshot when missing - VERIFIED.
- Canonical origin: canonicalUrl(path) in seo.ts uses config.auth.baseUrl <- env BETTER_AUTH_URL (src/api/config.ts; HTTPS enforced in production; dev/test default http://localhost:5173 per README/runtimeDefaults). The client hook src/web/lib/seo.ts hardcodes SITE_URL = 'https://rethinkloop.com' and mirrors head tags after SPA navigation (useSeo). Default head tags live in src/web/index.html.
- Private/noindex application routes (must never appear in llms.txt output): privatePageLabels map in seo.ts (hidden sign-in route, /about, /admin/credits, /debates, /deep-search, /ideas, /settings) plus /terms and /privacy (noindex by design).
- GOTCHA for any future head-link work: canonicalUrl is derived from isPublic alone (seo.ts:215) while noindex derives from public AND completed (seo.ts:227) - a public-but-running debate is canonical-bearing AND noindex. Any advertisement gate must be !noindex && canonicalUrl !== null.

KEY FILES AND SYMBOLS
- src/api/routes/seo.ts - seoPages(), sitemapXml(), robotsTxt(), publicDebateSlugs(), publicDeepSearchSlugs(), publicIdeas(), canonicalUrl(), resourcePath(), decodeSegment(), truncateDescription(), articleMetadata(), resolveSeoPage(), renderSeoDocument(), notFoundHtml, privatePageLabels.
- src/api/index.ts - mounting (line 109), setWebAssetCacheHeaders(), production catch-all (lines 144-185).
- src/api/routes/readAccess.ts - read scopes.
- src/api/routes/ideas/ideaSites.ts - ideaSitePath(), writeIdeaSite(), readIdeaSite(), readIdeaSiteScreenshot(), generateWinningIdeaSite().
- src/api/routes/ideas/index.ts - website serving routes, checkIdeaSiteAccess().
- src/api/routes/examples/index.ts - exampleDebateReads().
- src/api/config.ts - auth.baseUrl, ideaSites.dir, examples.debateIds.
- src/web/lib/seo.ts - SITE_URL, useSeo(); src/web/index.html - default head tags.
- src/api/routes/debates/snapshot.ts - getDebateJobSnapshot (assembles job+ideas+rounds+matches+messages); parseMessageText throws on malformed persisted verdicts.
- src/api/web_search/webExtract.ts:287-291 - only Content-Type text/plain takes the raw-text path; everything else gets HTML visible-text extraction (decisive for D6).
- Tests: src/api/routes/seo.test.ts (seed helpers seedDebate/seedMatch/seedDeepSearchRound, createSeoApp(debateJobIds) pattern; shared in-memory db; beforeEach clears tables).

CONTENT SOURCES FOR MARKDOWN RENDITIONS (DB evidence, src/api/db/schema/)
- Debate page: ideaJobs.title + ideaJobs.prompt (display identity lives on idea_jobs; debate_jobs holds isPublic/status/userId). Full content: debateRounds -> debateMatches -> debateMessages (speakerSlot 0/1 debater speeches, 2 judge explanation; text via llmGenerationId -> llmGenerations.text). Tournament scale: 12 participants, ~33 matches x 3 messages per debate (src/api/routes/debates/tournament.ts); speech output is uncapped (src/api/llms/provider.ts:69 - 384k context, no maxOutputTokens).
- Idea job page: ideaJobs.title/prompt; ideas.title/description plus refinedTitle/refinedDescription (resolveIdea uses refined values only once the evaluation generation completes and parses via parseIdeaEvaluation - src/api/routes/ideas/schemas.ts).
- Idea detail page: ideas.refinedTitle/refinedDescription with fallback to title/description (resolveIdea, seo.ts lines 361-416).
- Deep search page: deepSearchJobs.title/researchRequest; rounds: deepSearchRounds (position is 0-based; URLs are 1-based) with round report text in llmGenerations.text via llmGenerationId plus answerGenerationId; sources in deepSearchResults (title/shortText/url) under deepSearchQueries.
- Winner website: stored HTML (untrusted model output) at config.ideaSites.dir/<ideaId>/websites/index.html; raw generation text also in llmGenerations.text via debateJobs.websiteGenerationId. Per create-idea-site.md the page copy is bespoke (model decides structure; visual-first) - structured DB fields do not contain it.

DECISIONS (structured subagent debate, 2026-10-05: per-option advocates, cross-challenges, response rounds; two product calls left to the operator as D1/D3)
- D2 per-page format (resolved): Debate page files are BOUNDED SUMMARIES + LINKS (title, truncated prompt via truncateDescription, winner/outcome, links to child match/round files and to the canonical HTML). Match and round child files carry the FULL text (see D4). Ideas and deep-search pages inline FULL structured content (single-generation pages are bounded in practice). No per-entity llms-full.txt (it would duplicate child files; the spec's page.md / rel=alternate mechanism is a future option). Converged by all three option advocates.
- D4 child pages (resolved): own file per child page: /debates/:slug/matches/:matchId/llms.txt and /deep-search/:slug/rounds/:roundNumber/llms.txt. Conditions: identical public+completed gating as resolveSeoPage resolving as anonymous viewer (404 otherwise, including malformed/foreign children); parent links children instead of embedding their text; per-file size ceiling for oversized children (skip/summarize within the child file).
- D5 discovery (resolved): advertise via ONE comment line in robotsTxt() (seo.ts:165-171) after the Sitemap line: '# llms.txt: ' + canonicalUrl('/llms.txt'). Do NOT add HTML head rel=alternate links now - defer until a documented consumer exists; if ever added, gate on !noindex && canonicalUrl !== null (see GOTCHA above) in BOTH renderSeoDocument and useSeo.
- D6 content type (resolved): text/plain; charset=utf-8 for all llms.txt responses, matching the robots.txt sibling. Evidence: webExtract.ts:287-291 mangles non-plain types; 8/8 reference implementations (incl. spec author's sites) serve text/plain; one-line switch later if Link-header advertisement is ever adopted.
- D7 canonical origin (resolved): llms.txt URLs use config.auth.baseUrl via canonicalUrl() only; do NOT touch web SITE_URL in this ticket. Create follow-up ticket 'Unify web SITE_URL with API canonical origin' as part of landing #32; that ticket must decide the mechanism explicitly and record that window.location.origin is wrong for canonicals in preview environments (server/client heads never disagree in dev because head injection is production-only).

REMAINING OPERATOR DECISIONS (recommendations recorded; do not implement these two items without an explicit answer)
- D1 index scope: RECOMMENDED DEFAULT = examples-only index mirroring the sitemap scope (README documents curated promotion as deliberate policy; per-page files still exist for every public slug, so nothing is hidden - the index just does not catalogue uncurated content). Switch to ALL public+completed content (examples first) only if the operator confirms organic LLM/SEO discovery of user content is a product goal. Reversal cost ~one parameterized query (drop the inArray filter in the public*Slugs queries).
- D3 generated-website rendition: depends on intent. (a) Curated idea summary (recommended default): request-time markdown from structured DB data (refinedTitle/refinedDescription + prompt, title/description fallback) served from the idea-detail per-page file URL /ideas/:slug/:ideaId/llms.txt - zero migration, no drift (refined fields are write-once before website generation, ideaSites.ts:212-218, 312-317), no untrusted-HTML parsing. (b) Faithful page text: HTML-to-text conversion at GENERATION time (converter at generation, stored next to index.html, extending the ideaSites.ts repair block) - but extraction yield on JS/visual-heavy pages is UNVERIFIED; smallest test: run the candidate extractor over 3-5 stored pages in IDEA_SITES_DIR and measure text yield before committing. All variants: hard 404 unless root debate isPublic AND completed; content-type and headers per D5/D6.

EXISTING PATTERNS AND CONVENTIONS
- Crawler endpoints are plain app.get() handlers registered in seoPages() returning c.text(body, 200, {'Content-Type': ...}); no zValidator on these routes today; sitemap URL-encodes slugs via resourcePath (encodeURIComponent); resolveSeoPage decodes with decodeSegment and rejects segments containing '/'.
- Hono API routes live under basePath('/api') with zValidator('param', ...) zod schemas (src/api/docs/standards.md). Node runs TypeScript directly (--experimental-strip-types, no build step; imports use .ts extensions - src/api/docs/runtime.md).
- Tests are colocated vitest files with in-memory SQLite (src/api/docs/testing.md); seo.test.ts shows the seeding pattern for public/private/running/failed debates and endpoint assertions on exact body, Content-Type, and status.
- Per AGENTS.md, an implementation agent must read src/api/gatekeep.md plus relevant docs (runtime, standards, testing; routes docs for debate-jobs/idea-jobs/deep-search-jobs) before coding.

CONSTRAINTS, EDGE CASES, ACCEPTANCE CRITERIA
- Private (not isPublic), non-completed (running/failed), and noindex content must never be listed in or exposed through llms.txt output; unauthenticated per-page requests for such slugs must 404.
- Slug handling must mirror existing behaviour: URL-encode in generated links (resourcePath), decode+validate in paths (decodeSegment), UUID validation for match ids (uuidSchema), 1-based round validation (oneBasedRoundNumberSchema).
- Content-Type: text/plain; charset=utf-8 (D6). Cache headers consistent with existing seo.ts crawler endpoints (robots/sitemap set none beyond Content-Type).
- Tests beside src/api/routes/seo.test.ts: index lists only the in-scope public/completed content (per D1); per-page and child files 404 for private/incomplete/malformed slugs; content-type and URL shape asserted.
