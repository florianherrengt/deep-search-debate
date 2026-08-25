---
id: 19
title: Add Google Maps Routes API as a tool for the LLM
status: backlog
priority: medium
created: 2026-08-25T10:18:24.625682+01:00
updated: 2026-08-25T10:19:17.165636+01:00
tags:
    - feature
class: standard
---

## Goal

Give the LLM (deep-search pipeline, and possibly ideas pipeline) a travel-comparison capability: given an origin and destination, return travel time/distance for multiple modes (DRIVE, BICYCLE, TRANSIT, WALK) so research like "Berlin vs Hamburg by car vs train" produces real routing numbers instead of generic web hits.

## Mechanism (decided 2026-08-25 — Florian)

Google Maps Routes API, `computeRoutes`, once per travelMode:

```ts
const modes = ["DRIVE", "BICYCLE", "TRANSIT"]
for (const travelMode of modes) {
  POST https://routes.googleapis.com/directions/v2:computeRoutes
  {
    origin:      { location: { latLng: { latitude, longitude } } },
    destination: { location: { latLng: { latitude, longitude } } },
    travelMode
  }
}
```

- Origin/destination accept addresses, Place IDs, or lat/lng directly.
- Request only `routes.duration` + `routes.distanceMeters` → tiny responses.
- A 3-mode comparison = 3 route requests. Compute Route Matrix does NOT support bicycle — use `computeRoutes` per mode.
- Use Google, no routing-library abstraction (skip unless provider swapping becomes real). Mapbox is fine for driving/cycling but Google wins on global transit coverage.

## Cost (verified via Google pricing docs 2026-08-25)

- Compute Routes Essentials: 10,000 free requests/month, then about $5 per 1,000 up to 100k.
- Traffic-aware routing / advanced options move to more expensive SKUs — avoid unless needed.

## Repository context (verified 2026-08-25)

- The deep-search pipeline (src/api/routes/deepSearch/pipeline.ts:709) calls `webSearch()` (src/api/web_search/index.ts) per planned query — two providers behind `config.webSearch.provider` (serper, searxng), returning { results, creditsUsed }.
- The LLM is not a tool-calling agent today — "tool" means a search capability the pipeline can invoke; queries are planned by the agent (src/api/agents/deep_search/queries.ts) and executed by the pipeline.
- No maps/places/routing code exists anywhere in the repo.

## Open questions (resolve before implementation)

- Which LLM surfaces need it: deep-search only, or also ideas/debates?
- How the LLM triggers it: query classification vs. a dedicated pipeline step (e.g. detect route-comparison intents in planned queries)?
- Input resolution: model returns addresses/lat-lng directly, or a geocoding step first?
- Result shape: new route-result type vs. extending WebSearchResult; how it surfaces in search-results events.
- Credits/pricing for route requests.

## Scope of work (to refine after decisions)

- Routes API client + env config (API key), no abstraction layer
- Pipeline wiring so the LLM can trigger route comparisons
- Result typing/serialization into search events
- Tests per src/api/docs/testing.md conventions
