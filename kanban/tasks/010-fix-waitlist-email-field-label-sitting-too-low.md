---
id: 10
title: Fix waitlist email field label sitting too low
status: done
priority: high
created: 2026-08-22T19:03:26.002552+01:00
updated: 2026-08-22T22:01:38.733543+01:00
started: 2026-08-22T19:06:20.449646+01:00
completed: 2026-08-22T22:01:38.733986+01:00
class: standard
---

In the Join the waiting list dialog (src/web/components/waitlist/Waitlist.tsx), the Email address field's floating label (which acts as the placeholder while empty) renders several pixels below the vertical center of the field — it hugs the bottom border.

Reproduction: click any 'Join the waiting list' button, inspect the outlined email field. Field is 42px tall; the not-shrunk label (0.875rem, 20px line box) is translated translate(14px, 16px) so its box spans 16-36px of the 42px height — ~5px below center (top gap 16px, bottom gap 6px).

Root cause: MUI v9 hardcodes the not-shrunk outlined label offset at translate(14px, 16px) (node_modules/@mui/material/InputLabel/InputLabel.js:154), tuned for the default 56px-tall field. The app theme (src/web/theme.ts) shrinks every outlined input via MuiOutlinedInput overrides (minHeight: 40, input padding '10px 12px'), which the label offset does not account for. Likely affects every outlined TextField in the app, not just the waitlist dialog.

Suggested fix: compensate in the theme (MuiInputLabel styleOverride for outlined, not-shrunk state, e.g. translateY ~11px), then verify focus/filled shrink state and helper text are unaffected. Visual check available in the waitlist dialog on the landing page.

[[2026-08-22]] Sat 22:00
Implemented in .worktrees/task-10-waitlist-label: MuiInputLabel outlined[data-shrink=false] translate(14px,11px); multiline roots aligned to compact padding with textarea reset. Verified in browser across default/small/select/multiline (resting labels within 0.3px of text-line center; shrunk state untouched). lint+typecheck+tests green; knip findings pre-existing.
