---
id: 32
title: 'Add llms.txt: site index plus per-page files for public content'
status: backlog
priority: medium
created: 2026-10-05T11:23:59.715568+01:00
updated: 2026-10-05T11:34:47.599424+01:00
tags:
    - seo
    - api
class: standard
---

GOAL
Expose RethinkLoop content to LLM crawlers via llms.txt (llmstxt.org): a site-level index plus per-page plain-markdown renditions of public content, e.g. /debates/:slug/llms.txt. Motivation: today crawlers get SPA HTML with injected head metadata only (resolveSeoPage / renderSeoDocument); page body content is client-rendered, so no crawlable full-text representation of any debate, idea, deep search, or generated website exists.

SCOPE (original intent, unchanged)
1. GET /llms.txt - site index following the llmstxt.org format: title, blockquote summary, H2 sections per entity type (debates, ideas, deep searches, examples) linking public pages with one-line descriptions.
2. Per-page llms.txt for public entity routes, returning that page content as markdown:
   - /debates/:slug/llms.txt
   - /ideas/:slug/llms.txt
   - /ideas/:slug/:ideaId/llms.txt
   - /deep-search/:slug/llms.txt
3. Generated idea websites: provide an llms.txt/markdown rendition of the winner website content.
4. Wire-up, content-type, cache headers, and 404 behaviour consistent with existing SEO endpoints.

CURRENT BEHAVIOUR (verified in code)
- src/api/routes/seo.ts registers crawler endpoints OUTSIDE the /api basePath: seoPages(app) is called at src/api/index.ts:109 and serves GET /robots.txt (robotsTxt()) and GET /sitemap.xml (sitemapXml()).
- sitemapXml(debateJobIds) builds paths from publicDebateSlugs / publicDeepSearchSlugs / publicIdeas (seo.ts lines 70-137). All three filter on debateJobs.isPublic = true AND debateJobs.status = 'completed'. SCOPING NUANCE: they only consider the debateJobIds passed into seoPages(app, debateJobIds = config.examples.debateIds) - i.e. the sitemap lists ONLY operator-curated EXAMPLE_DEBATE_IDS content plus / and /examples, not every public debate.
- Production serving: src/api/index.ts lines 144-185. When config.environment === 'production', the app serves the built SPA from ../web/dist via serveStatic, then a catch-all calls resolveSeoPage(path, viewerUserId); not-found returns notFoundHtml with 404 + X-Robots-Tag: noindex; found pages get renderSeoDocument(webIndex, metadata, pageKey) with Cache-Control: private, no-store. Body content is still client-rendered (prerendered head, not SSR).
- Visibility model: resolveSeoPage (seo.ts line 512) resolves per-route SeoMetadata. Public entity pages are indexable only when the root debate isPublic AND status completed; private resources resolve for their owner (viewerUserId) with noindex and null canonical; non-owners get not-found. API-side read scopes live in src/api/routes/readAccess.ts (debateJobReadScope, ideaJobReadScope, deepSearchJobReadScope).
- Public API read routes (optional session): GET /api/idea-jobs/:slug, GET /api/deep-search-jobs/:slug, GET /api/debate-jobs/:slug, GET /api/examples (exampleDebateReads in src/api/routes/examples/index.ts returns curated public completed debates).
- GENERATED IDEA WEBSITES - CORRECTION TO EARLIER NOTE: they ARE served today. src/api/routes/ideas/ideaSites.ts stores one self-contained HTML page per winning idea at config.ideaSites.dir/<ideaId>/websites/index.html (env IDEA_SITES_DIR, fallback environmentDefaults.ideaSitesDir in src/api/config.ts) plus screenshot.png. Served by routes in src/api/routes/ideas/index.ts:
  - GET /api/idea-jobs/:ideaJobId/ideas/:ideaId/website (readIdeaSite) - Content-Type text/html, Content-Security-Policy: sandbox allow-scripts (generated pages are model output, untrusted), X-Content-Type-Options: nosniff, Cache-Control: no-store.
  - GET /api/idea-jobs/:ideaJobId/ideas/:ideaId/website/screenshot.png (readIdeaSiteScreenshot).
  Access: checkIdeaSiteAccess (ideas/index.ts line 55) via ideaJobReadScope - owner or descendant of a public debate. Generation: generateWinningIdeaSite / generateIdeaSite (PromptName.CreateIdeaSite); the winning website HTML generation is linked from debateJobs.websiteGenerationId.
- Canonical origin: canonicalUrl(path) in seo.ts uses config.auth.baseUrl <- env BETTER_AUTH_URL (src/api/config.ts; HTTPS enforced in production). The client hook src/web/lib/seo.ts hardcodes SITE_URL = 'https://rethinkloop.com' and mirrors the same head tags after SPA navigation (useSeo). Default head tags live in src/web/index.html.
- Private/noindex application routes (must never appear in llms.txt output): privatePageLabels map in seo.ts (hidden sign-in route, /about, /admin/credits, /debates, /deep-search, /ideas, /settings) plus /terms and /privacy (noindex by design).

KEY FILES AND SYMBOLS
- src/api/routes/seo.ts - seoPages(), sitemapXml(), robotsTxt(), publicDebateSlugs(), publicDeepSearchSlugs(), publicIdeas(), canonicalUrl(), resourcePath(), decodeSegment(), truncateDescription(), articleMetadata(), resolveSeoPage(), renderSeoDocument(), notFoundHtml, privatePageLabels.
- src/api/index.ts - mounting (line 109), setWebAssetCacheHeaders(), production catch-all (lines 144-185).
- src/api/routes/readAccess.ts - read scopes.
- src/api/routes/ideas/ideaSites.ts - ideaSitePath(), writeIdeaSite(), readIdeaSite(), readIdeaSiteScreenshot(), generateWinningIdeaSite().
- src/api/routes/ideas/index.ts - website serving routes, checkIdeaSiteAccess().
- src/api/routes/examples/index.ts - exampleDebateReads().
- src/api/config.ts - auth.baseUrl, ideaSites.dir, examples.debateIds.
- src/web/lib/seo.ts - SITE_URL, useSeo(); src/web/index.html - default head tags.
- Tests: src/api/routes/seo.test.ts (seed helpers seedDebate/seedMatch/seedDeepSearchRound, createSeoApp(debateJobIds) pattern for endpoint tests; shared in-memory db; beforeEach clears tables).

CONTENT SOURCES FOR MARKDOWN RENDITIONS (DB evidence, src/api/db/schema/)
- Debate page: ideaJobs.title + ideaJobs.prompt (display identity lives on idea_jobs; debate_jobs holds isPublic/status/userId). Full debate content: debateRounds (stage, stageRoundNumber) -> debateMatches (position, firstIdeaId/secondIdeaId) -> debateMessages (position, speakerSlot 0/1 debater speech, 2 judge explanation; text via llmGenerationId -> llmGenerations.text).
- Idea job page: ideaJobs.title/prompt; ideas table: title/description plus refinedTitle/refinedDescription (resolveIdea uses refined values only once the evaluation generation completed and parses via parseIdeaEvaluation - src/api/routes/ideas/schemas.ts).
- Idea detail page: ideas.refinedTitle/refinedDescription with fallback to title/description (resolveIdea, seo.ts lines 361-416).
- Deep search page: deepSearchJobs.title/researchRequest; rounds: deepSearchRounds (position is 0-based; URLs are 1-based) with round report text in llmGenerations.text via llmGenerationId plus answerGenerationId; sources in deepSearchResults (title/shortText/url) under deepSearchQueries.
- Winner website: stored HTML (untrusted model output) at config.ideaSites.dir/<ideaId>/websites/index.html; the raw generation text also lives in llmGenerations.text via debateJobs.websiteGenerationId. No markdown/plain-text rendition is stored today.

EXISTING PATTERNS AND CONVENTIONS
- Crawler endpoints are plain app.get() handlers registered in seoPages() returning c.text(body, 200, {'Content-Type': ...}); robots uses text/plain, sitemap application/xml. No zValidator on these routes today; sitemap XML-escapes via escapeXml and URL-encodes slugs via resourcePath (encodeURIComponent); resolveSeoPage decodes with decodeSegment and rejects segments containing '/'.
- Hono API routes live under basePath('/api') with zValidator('param', ...) zod schemas (src/api/docs/standards.md). Node runs TypeScript directly (--experimental-strip-types, no build step; imports use .ts extensions - src/api/docs/runtime.md).
- Tests are colocated vitest files with in-memory SQLite (src/api/docs/testing.md); seo.test.ts shows the seeding pattern for public/private/running/failed debates and endpoint assertions on exact body, Content-Type, and status.
- Per AGENTS.md, an implementation agent must read src/api/gatekeep.md plus relevant docs (runtime, standards, testing; routes docs for debate-jobs/idea-jobs/deep-search-jobs) before coding.

CONSTRAINTS, EDGE CASES, ACCEPTANCE CRITERIA
- Private (not isPublic), non-completed (running/failed), and noindex content must never be listed in or exposed through llms.txt output; unauthenticated per-page requests for such slugs must 404 like resolveSeoPage not-found (the owner-visible noindex behaviour of HTML pages need not transfer to a text endpoint - needs a decision).
- Slug handling must mirror existing behaviour: URL-encode in generated links (resourcePath), decode+validate in paths (decodeSegment), UUID validation for match ids (uuidSchema), 1-based round validation (oneBasedRoundNumberSchema).
- Content-Type for llms.txt responses and cache headers must be chosen consistently with robots/sitemap (which set nothing beyond Content-Type) and the no-store policy used for dynamic document responses.
- The llmstxt.org spec defines a SITE-LEVEL llms.txt; per-page llms.txt files are an extension of the concept with no existing serializer in this repo (debate tournament data has no markdown renderer today).
- Tests beside src/api/routes/seo.test.ts: index lists only public/completed content; per-page files 404 for private/incomplete slugs; content-type and URL shape asserted.

OPEN QUESTIONS (do not resolve unilaterally)
1. Site index scope: should /llms.txt list ALL public completed debates or only the curated EXAMPLE_DEBATE_IDS content (mirroring the current sitemap, which is deliberately scoped to examples)?
2. Per-page file format: what exactly should /debates/:slug/llms.txt contain - full speech transcript in markdown, a summary, or structured sections? No markdown serialization of debate/deep-search data exists yet.
3. Generated website: should the rendition be (a) a stored <ideaId>/websites/llms.txt written at generation time in ideaSites.ts, (b) a route converting stored HTML to text, or (c) markdown built from structured idea data (refinedTitle/refinedDescription + research summary)? Also what URL shape - an /api/idea-jobs/... route like the website, or a crawler-facing path? CSP sandbox and no-store policies must be respected.
4. Which routes get their own file vs. a section in the parent file (debate match pages, deep-search rounds)?
5. Should llms.txt be linked from robots.txt (like Sitemap:) or the HTML head, and should per-page files be advertised (e.g. link rel=alternate)?
6. Content-Type: text/markdown vs text/plain for llms.txt responses.
7. src/web/lib/seo.ts SITE_URL duplicates config.auth.baseUrl - should generated absolute URLs in llms.txt use one canonical origin, and is unifying that duplication in scope for this ticket?
