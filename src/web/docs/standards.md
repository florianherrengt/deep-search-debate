# Web frontend standards

These standards define how frontend code is designed and implemented in
`src/web`. They describe the current architecture and apply to new code and to
related code being changed; they do not require an unrelated, repository-wide
migration.

The terms **MUST**, **SHOULD**, and **MAY** are normative. MUST identifies an
invariant, SHOULD identifies the default that needs a concrete reason to vary,
and MAY identifies an allowed choice. The web gatekeep checklist turns recurring
failures into short review checks; it does not replace this document.

## 1. Authority and scope

- Frontend changes MUST follow this document and the scoped documents linked
  from the root `AGENTS.md`.
- The implementation MUST reflect current product requirements and repository
  architecture rather than speculative future needs.
- Existing code outside the requested change MUST NOT be reorganized merely to
  conform to a preferred directory shape.
- Feature behavior and domain rules belong in feature documentation, not in
  these general standards.
- Any illustrative example added to this document MUST be labelled
  non-normative.

## 2. Approved stack and dependencies

The core frontend stack is React 19, strict TypeScript, MUI 9, React Router,
TanStack Query, Zod, Vitest, React Testing Library, Playwright, and Storybook.
Use the existing platform before adding an overlapping solution.

- MUI MUST remain the UI component and styling system. Do not mix in Tailwind,
  another component framework, or a parallel design-system framework.
- TanStack Query MUST own ordinary server-state fetching, caching, mutations,
  invalidation, and background refresh. Do not add another server-state library.
- React Router MUST own application routing and navigational URL state.
- Zod MUST validate untrusted data at browser trust boundaries.
- React Hook Form is the approved form library when a nontrivial form justifies
  one. Small forms MAY use ordinary React state and MUST NOT add React Hook Form
  merely for consistency.
- Immer is an available supporting dependency. It MAY be used when it materially
  clarifies complex immutable state transitions and SHOULD NOT be used for
  simple object or array updates.
- A global client-state library, including Redux, MUST NOT be added until
  genuine application-wide client state exists and React state, URL state,
  Query, or a narrowly scoped context cannot own it cleanly.
- Direct imports from `@emotion/react` or `@emotion/styled` MUST NOT be used for
  application styling. Emotion remains an implementation dependency of MUI.
- A new dependency MUST solve a concrete current problem better than the
  installed stack. Its maintenance cost, browser weight, type quality,
  accessibility, and overlap MUST be considered, and the reason MUST be
  documented durably when the choice establishes a new pattern.

## 3. Project structure and dependency direction

The project uses a feature-first layout under `pages/<Feature>/`. Route entry
points, feature components, hooks, selectors, reducers, presentation mappings,
and feature tests SHOULD remain colocated there.

- A feature MAY import its own modules and browser-safe shared infrastructure
  from `lib/`.
- A feature MUST NOT import another feature's internal modules. When multiple
  features need the same responsibility, promote the smallest coherent shared
  abstraction instead of moving an entire feature component.
- `lib/` contains browser-safe infrastructure and existing network-boundary
  modules. New feature-specific code SHOULD stay within its feature unless it
  has a genuine cross-feature responsibility; `lib/` MUST NOT become a generic
  dumping ground.
- Shared component, hook, model, schema, or utility directories SHOULD be
  created only after real cross-feature reuse exists. Generic root-level
  `utils`, `hooks`, or `schemas` collections MUST NOT be created pre-emptively.
- The web workspace MUST remain decoupled from API runtime modules and MUST NOT
  import from the API workspace. Browser-side contract schemas are deliberately
  mirrored and validated at the network boundary. Introducing a browser-safe
  shared contract package would be an explicit cross-workspace architecture
  change, not an incidental frontend refactor.
- New standards MUST be adopted without a big-bang feature-directory migration.

## 4. Components and React behavior

- Existing MUI primitives MUST be preferred for buttons, links, inputs, menus,
  dialogs, tabs, tables, and other standard interactions. Do not recreate their
  accessibility and behavior in custom primitives.
- A wrapper around an MUI component SHOULD exist only when it provides stable
  application semantics, not merely to rename props or restyle one use.
- Route components MAY coordinate URL state, queries, mutations, subscriptions,
  navigation, and screen-level state. Presentational components SHOULD receive
  the smallest stable interface appropriate to their responsibility and emit
  events upward.
- Raw query results and transport-layer objects SHOULD NOT be passed deeply
  through the component tree. Convert them at the boundary where a stable view
  interface or domain projection becomes useful; primitive props remain valid
  for small components.
- Components SHOULD be small enough to understand as a unit, but MUST NOT be
  split into fragments with no independent responsibility.
- Prefer composition over components with large sets of mode flags and
  configuration props.
- Domain transformations, state-machine transitions, and complex presentation
  mappings SHOULD live in pure selectors, reducers, or model functions rather
  than inside JSX.
- A one-off query does not require a custom hook. Extract a hook when it is
  reused, coordinates a lifecycle, or hides meaningful protocol complexity.
- Derived values MUST be computed from their source state rather than copied
  into state and synchronized with an effect.
- Effects MUST synchronize React with an external system such as a subscription,
  timer, browser API, or imperative widget. Effects MUST clean up subscriptions
  and other resources.
- Performance changes SHOULD follow measurement. Do not add memoization,
  virtualization, or deferred loading without evidence that it addresses a
  real cost.

## 5. MUI theme, styling, and visual principles

There MUST be one exported application theme used by the application and
Storybook, and by tests that require explicit theme context. `ThemeProvider` and
`CssBaseline` SHOULD remain application-level providers.

Use this styling order:

1. Theme tokens for global visual decisions.
2. `theme.components` for application-wide MUI defaults, variants, and visual
   overrides.
3. `sx` for local component and responsive layout.
4. MUI `styled()` for genuinely reusable styled elements.
5. CSS files only for work poorly expressed through MUI, such as complex
   animations or visualizations.

- Semantic palette, typography, spacing, shape, breakpoint, transition, and
  z-index tokens MUST be used when they express the intended value.
- Hardcoded colors MUST NOT duplicate a semantic palette token. Arbitrary pixel
  values SHOULD NOT duplicate spacing or radius tokens.
- Literal dimensions MAY be used for genuine geometry such as grid track
  minimums, viewport calculations, media dimensions, or externally constrained
  sizes.
- Because CSS theme variables are enabled, reusable theme callbacks SHOULD use
  `theme.vars` where appropriate. Scheme-specific styles MUST use
  `theme.applyStyles()` rather than imperative `theme.palette.mode` branching.
- Deeply nested selectors, `!important`, and unexplained mixtures of inline
  `style`, CSS files, and `sx` MUST be avoided.
- Responsive CSS and breakpoint-aware `sx` values SHOULD be used instead of
  JavaScript viewport-width checks.
- Screens with competing actions SHOULD establish one obvious primary action.
- Typography, spacing, and layout SHOULD establish hierarchy before decorative
  borders, surfaces, or color are added.
- Prose SHOULD use a readable line length. Tables, tournament boards, transcripts,
  and other data-heavy workspaces MAY use wider containers.
- Product copy SHOULD use sentence case and clear verb-based action labels.
- Status presentation MUST combine text or accessible naming with any color or
  icon treatment.
- Secondary and advanced controls SHOULD use progressive disclosure when showing
  them permanently would obscure the primary task.
- Loading and refresh behavior SHOULD preserve layout and content stability.
- Motion MUST communicate state or spatial change, and MUST respect the user's
  reduced-motion preference.

## 6. State, URL, API, streaming, and forms

Use the narrowest owner that preserves the required behavior.

### State ownership

- TanStack Query MUST own API snapshots, loading and request-error state,
  caching, refetching, and mutations. Query data MUST NOT be copied into React
  state.
- State that users reasonably expect to survive reload, participate in browser
  back/forward navigation, or be shareable SHOULD live in the URL. This includes
  resource identifiers and navigational filters, sorting, pagination, search,
  and selected views where those behaviors matter.
- Local React state SHOULD own ephemeral interface state such as an open dialog,
  expanded section, or unsubmitted selection.
- `useReducer` MAY own feature-local state with meaningful transitions. Reducers
  SHOULD use discriminated actions and remain deterministic.
- Context MAY provide stable cross-cutting capabilities or scoped coordination.
  It MUST NOT become a giant mutable application cache.

### API boundaries

- Visual components MUST NOT construct URLs or scatter direct `fetch()` calls.
  Browser requests belong in the existing network layer or a focused feature
  boundary.
- Query and mutation configuration MAY remain in a route component when used
  once. Reusable or lifecycle-heavy query behavior SHOULD be exposed through a
  feature-local hook.
- Fetches and stream readers MUST accept and respect `AbortSignal` where their
  caller controls a lifecycle. Identifiers interpolated into URLs MUST be
  encoded.
- External data begins as `unknown` and MUST be parsed with Zod or narrowed by a
  real type guard before domain code consumes it.
- Application errors SHOULD retain structured status or cause information needed
  for user-facing handling. Errors MUST NOT be silently swallowed, and failed
  requests MUST NOT be replaced with invented production data.
- The server remains authoritative for validation and authorization. Client-side
  validation exists to improve usability, not to establish trust.

### Streaming

- Durable API snapshots are canonical for snapshot-backed workflows. Stream
  events SHOULD normally trigger invalidation, refetch, reconnect, or explicit
  reconciliation with that snapshot rather than becoming a competing durable
  state store.
- A feature-local reducer MAY consume replayed stream events directly when the
  evolving stream output is itself the delivered user-visible content. That
  protocol MUST define reconnection, replay or duplicate handling, ordering,
  cancellation, completion, failure, and how reopening reconstructs the result.
- A workflow MUST make its snapshot-invalidation or replayed-content ownership
  model explicit and MUST NOT mix the two accidentally.

### Forms

- Simple forms MAY use controlled React state. Significant forms SHOULD use
  React Hook Form with a Zod schema once their validation, field count, or
  interaction complexity justifies the dependency.
- Fields MUST use MUI inputs with visible labels and display field errors beside
  the relevant control. Non-field errors MUST be shown at form level.
- Submitted values MUST be preserved after server errors unless successful
  completion intentionally resets the form.
- Submission MUST be guarded while pending to prevent accidental duplicates.
- Forms SHOULD provide sensible defaults and progressively disclose advanced
  options.
- Generic schema-generated forms MUST NOT be introduced without repeated,
  concrete evidence that they reduce complexity.

## 7. Loading, errors, and resilience

- Every asynchronous boundary MUST render every state it can reach: initial
  loading, success, empty, recoverable error, partial or stale data, not found,
  and permission denied where applicable.
- Empty data is a valid outcome and MUST NOT be presented as a request failure.
- Skeletons SHOULD be used when the eventual structure is known. Indeterminate
  progress indicators SHOULD communicate actions with unknown duration.
- Existing useful data SHOULD remain visible during background refresh. Do not
  replace an entire screen with a spinner unnecessarily or leave an unexplained
  blank screen while loading.
- Error messages MUST be safe, understandable, and actionable. Recovery controls
  SHOULD be provided where retry or navigation can resolve the failure.
- Request-error UI and React render error boundaries solve different failures.
  Routes or feature boundaries SHOULD provide render-error recovery appropriate
  to their scope.
- Unknown application routes MUST render an explicit not-found experience.
- Terminal workflows MUST NOT leave pending children, active status copy, or
  loading indicators that imply work continues.

## 8. Accessibility and responsive behavior

### Search and share metadata

- The production server MUST put route-specific title, description, robots,
  canonical, Open Graph, Twitter, and structured-data tags in the initial HTML;
  a post-render React effect is not a substitute for crawler-visible HTML.
- The client MUST mirror that metadata during SPA navigation through the shared
  SEO helper. It MUST preserve server metadata while route data is still
  loading rather than temporarily replacing a valid page with not-found tags.
- Canonical URLs MUST use the configured production origin and URL-encoded path
  segments. Private pages MUST omit canonical URLs and structured data.
- Only completed resources inherited from a public debate MAY be indexable.
  Private, standalone, running, failed, interrupted, authenticated workspace,
  sign-in, placeholder, and not-found pages MUST be `noindex`.
- A detail response's validated `isPublic` and `isIndexable` projections are the
  browser authority for inherited visibility and root-debate completion. The
  browser MUST NOT guess those facts from child-job status.
- Every resource URL MUST have one metadata owner. An individual idea uses its
  own durable or refined title, description, canonical URL, and structured data
  rather than inheriting the parent idea-run canonical.

- All interactive controls MUST be keyboard operable and use the correct
  semantic element.
- Inputs MUST have visible labels. Icon-only controls MUST have accessible names.
- Focus MUST remain visible. Dialogs, menus, and other overlays MUST manage focus
  correctly and restore it when they close.
- Meaning MUST NOT be communicated through color alone, and text and controls
  MUST maintain adequate contrast in every supported color scheme.
- Dynamic and streaming updates MUST use appropriate live-region semantics
  without overwhelming assistive technology.
- Reduced-motion preferences MUST be respected.
- MUI's accessible interaction behavior SHOULD be preserved, but using MUI does
  not remove responsibility for heading structure, labels, announcements, or
  application-specific focus behavior.
- Every screen MUST remain usable on narrow mobile and desktop widths. Content
  SHOULD wrap or reflow; intentional horizontal scrolling MUST be contained to
  structures such as tables, brackets, visualizations, or code.

## 9. TypeScript and testing

- TypeScript MUST remain strict. `any` MAY appear only when bridging a genuinely
  untyped dependency and MUST have a local explanation; trust-boundary data MUST
  use `unknown`, not `any`.
- Local types SHOULD be inferred when clear. Types SHOULD be exported only when
  they form a shared interface.
- Discriminated unions SHOULD represent domain state variants, and state-machine
  switches MUST be exhaustive when every variant requires handling.
- Type assertions MUST NOT replace validation or invariant checks. Use an
  assertion only when correctness has already been established outside the type
  system.
- Unit tests SHOULD cover pure transformations, validation, selectors, reducers,
  and independently meaningful state transitions.
- Component tests SHOULD cover user-visible behavior, forms, reachable loading
  and error states, conditional controls, and accessibility-sensitive
  interactions. Prefer exercising hooks through their consumer unless the hook
  is independently complex.
- Tests MUST assert observable behavior, prefer accessible role and label
  queries, and MUST NOT depend on MUI-generated class names.
- Tests SHOULD mock network or protocol boundaries rather than internal hooks or
  implementation details.
- Large component snapshots and arbitrary coverage targets MUST NOT substitute
  for risk-based assertions.
- Each durable workflow SHOULD have happy-path browser E2E coverage. Critical
  failure, retry, refresh or reopen, recovery, and cancellation behavior SHOULD
  receive E2E coverage where supported and focused lower-level coverage where it
  provides faster diagnosis.
- Storybook SHOULD cover reusable visual components and meaningful loading,
  running, completed, failed, empty, long-content, and responsive states.
  Application-wide providers belong in the global preview unless a story needs
  a state-specific override.
- A bug fix SHOULD add a regression test when the behavior can be tested at a
  proportionate level.

## 10. Simplicity, exceptions, and prohibited patterns

- Build the simplest implementation that satisfies the current requirement.
- Do not create abstractions for hypothetical use, generalize after one use, add
  dependencies for trivial utilities, or optimize without measurement.
- Prefer small, readable duplication over a premature abstraction. This does not
  justify duplicating sources of truth, validation guarantees, or security
  boundaries.
- Delete obsolete code instead of retaining dead compatibility layers or
  parallel implementations.
- Comments SHOULD explain non-obvious decisions and constraints, not restate the
  code.

The following patterns are prohibited unless a narrow documented exception
demonstrates why the existing architecture cannot satisfy the requirement:

- Tailwind or another component and styling system mixed with MUI.
- Rebuilt buttons, dialogs, menus, inputs, tabs, or tables that discard MUI's
  semantics and behavior.
- Hardcoded semantic design values that duplicate theme tokens.
- API calls or business state machines embedded in visual JSX.
- Query results copied into local state.
- Giant mutable global contexts, premature global stores, or micro-frontends.
- Universal table or form abstractions designed for hypothetical consumers.
- Large families of pass-through wrapper components.
- Fake production fallback data or silent error handling.

A MUST rule MAY be broken only when the implementation records a short
explanation beside the exception or in the relevant feature documentation. The
exception MUST be narrow, MUST preserve the rule's underlying invariant where
possible, and MUST NOT silently establish a new general pattern. A durable new
pattern requires updating these standards and the relevant gatekeep checklist.
