---
id: 32
title: 'Add llms.txt: site index plus per-page files for public content'
status: backlog
priority: medium
created: 2026-10-05T11:23:59.715568+01:00
updated: 2026-10-05T11:23:59.715568+01:00
tags:
    - seo
    - api
class: standard
---

Goal: expose RethinkLoop content to LLM crawlers via llms.txt (llmstxt.org): a site-level index plus per-page plain-markdown renditions of public content.

EXISTING INFRASTRUCTURE (audit evidence)
- src/api/routes/seo.ts already serves /robots.txt and /sitemap.xml outside the /api basePath (registered via seoPages(app) in src/api/index.ts) and injects meta/JSON-LD into the SPA shell in production (resolveSeoPage / renderSeoDocument).
- Public-only queries already exist there: publicDebateSlugs, publicIdeas, publicDeepSearchSlugs (public + completed only) - reuse these for the llms.txt index.
- Canonical base URL: config.auth.baseUrl (env BETTER_AUTH_URL); src/web/lib/seo.ts also hardcodes SITE_URL = https://rethinkloop.com.
- Generated idea websites: src/api/routes/ideas/ideaSites.ts writes a self-contained index.html per winning idea under config.ideaSites.dir (env IDEA_SITES_DIR); these are stored files, not routed URLs today.

SCOPE
1. GET /llms.txt - site index following the llmstxt.org format: title, blockquote summary, H2 sections per entity type (debates, ideas, deep searches, examples) linking public pages with one-line descriptions. Public + completed only, same filtering as sitemap.xml.
2. Per-page llms.txt for public entity routes, returning that page content as markdown:
   - /debates/:slug/llms.txt
   - /ideas/:slug/llms.txt
   - /ideas/:slug/:ideaId/llms.txt
   - /deep-search/:slug/llms.txt
   Decide during implementation whether match pages (/debates/:slug/matches/:matchId) and deep-search rounds (/deep-search/:slug/rounds/:roundNumber) get their own file or a section in the parent file.
3. Generated idea websites: emit llms.txt (or a markdown body) next to the per-idea websites/index.html in ideaSites.ts. Note these files are currently not served by any route - confirm whether a serving route is needed for this to be reachable, or whether the files are consumed elsewhere.
4. Wire-up: register routes in seoPages() next to robots/sitemap; content-type text/markdown; cache headers consistent with existing SEO endpoints; private/noindex/incomplete content must 404 like resolveSeoPage does.

WHERE ELSE IT APPLIES (audit result)
- / (home) and /examples belong in the site index; dedicated per-page files optional.
- Noindex routes (about, settings, admin, sign-in, terms, privacy, owner dashboards) must be excluded everywhere.
- src/web/lib/seo.ts SITE_URL duplicates config.auth.baseUrl - generated absolute URLs should use one canonical origin.

TESTS
- Beside src/api/routes/seo.test.ts: index lists only public/completed content; per-page files 404 for private/incomplete slugs; content-type and URL shape asserted.
