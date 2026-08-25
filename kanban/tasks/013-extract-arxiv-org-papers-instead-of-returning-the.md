---
id: 13
title: Extract arxiv.org papers instead of returning the abstract page
status: backlog
priority: medium
created: 2026-08-24T12:11:42.150579+01:00
updated: 2026-08-24T12:11:42.150579+01:00
tags:
    - feature
class: standard
---

When a deep search finds a page on arxiv.org, the app currently extracts the abstract page (https://arxiv.org/abs/<id>) like any other result. The abstract page carries little of the paper content, so the model summary it feeds is thin.

Expected: when a result URL is an arxiv.org paper, extract the full paper instead of the HTML page. The web extractor (src/api/web_search/webExtract.ts) already handles PDFs, so rewriting arxiv URLs to the PDF form (https://arxiv.org/pdf/<id>) before extraction is the likely minimal path.

Points to decide: where to rewrite (early in normalizeWebSearchResults in src/api/web_search/types.ts so the persisted page URL matches the extracted content, or only at extraction time); handling of arxiv.org/pdf URLs the search provider may already return; fallback to the arXiv API (export.arxiv.org/api/query) or to the abstract page when PDF extraction fails.
