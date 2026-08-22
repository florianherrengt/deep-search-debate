---
id: 5
title: Render user prompts as markdown everywhere
status: review
priority: medium
created: 2026-08-22T16:41:53.304701+01:00
updated: 2026-08-23T00:15:40.105993+01:00
started: 2026-08-22T16:55:09.057754+01:00
class: standard
---

Context: users can enter markdown in prompt/request inputs (all inputs are already multiline: DebatePromptForm.tsx:77-86, shared PromptForm.tsx:36-43). The display side renders the text as plain Typography, so newlines collapse and markdown (e.g. **bold**, lists) shows as raw text.

Desired behaviour (confirmed): render the FULL user prompt as markdown in every place it is displayed:

1. Debate detail "Prompt" accordion — src/web/pages/Debates/components/DebateView.tsx:87-100.
2. Idea run page prompt under the title — src/web/pages/Ideas/components/IdeaJobView.tsx:261-266.
3. Deep-search page research request — src/web/pages/DeepSearch/components/DeepSearchOverview.tsx:136-141.
4. Deep-search round detail "Research question" — src/web/pages/DeepSearch/components/DeepSearchRoundDetail.tsx:286-291.
5. Examples gallery debate cards — src/web/pages/Examples/index.tsx:64-66.

Out of scope (confirmed): the truncated prompt excerpts in the previous-jobs lists (src/web/components/JobHistoryListItem.tsx:60 via getPromptExcerpt in src/web/lib/promptPresentation.ts) stay plain-text previews.

Implementation: reuse the existing markdown rendering in the repo — FormattedStreamText with format="markdown" (src/web/components/streaming/FormattedStreamText.tsx:71-120, react-markdown ^10.1.0 already a dependency) or the same ReactMarkdown + MUI styling approach. Consider extracting a small shared MarkdownText/Markdown component since it will now be used in 5 places (coordinate with ticket #6 if the ExternalLink component lands first — markdown links render via MUI Link with target=_blank, FormattedStreamText.tsx:108-113).

Tests: update assertions that match raw prompt text (e.g. src/web/pages/Debates/components/DebateView.stories.test.tsx:30,35, src/web/pages/DeepSearch/components/DeepSearchOverview.test.tsx, DeepSearchRoundDetail.test.tsx, Ideas tests) so they still find the rendered text.

[[2026-08-23]] Sun 00:15
## Handoff — ready to merge
- Implemented on branch `task/5-prompt-markdown` (commit 64de5cb): shared `src/web/components/MarkdownText.tsx`, reused by FormattedStreamText (stream sizing preserved) and all five prompt sites; out-of-scope excerpts untouched.
- Verified on branch: web units 274/274 (3 new MarkdownText tests), lint+typecheck clean, Storybook LongPrompt accordion visually confirmed.
- Merge blocked ONLY by uncommitted DebateView.tsx + IdeaJobView.tsx on main (task #9 idea-sites WIP).
- To land once committed/stashed: `git merge task/5-prompt-markdown`, then `npm run test -w @rethinkloop/web`. Their WIP touches different regions of those files; conflicts unlikely but re-check DebateView accordion area.

[[2026-08-23]] Sun 00:15
Ready to merge: task/5-prompt-markdown; remaining: git merge after main's DebateView/IdeaJobView WIP lands
