# T-0007: Background overlay controls (render + opacity + simple transform)

Created: 2026-02-26
Estimate: 3 points
Owner: simonas
Status history (append-only):
- 2026-02-26: OPEN
- 2026-02-26: IN_PROGRESS
- 2026-02-26: DONE

## Goal
Show the plan reference image in the editor and let the user adjust it enough to trace comfortably.

## Acceptance criteria
- [x] Background image renders in the canvas using `plan.background` source/transform/opacity.
- [x] User can adjust background opacity from the app UI.
- [x] User can adjust background position and uniform scale using explicit controls (simple, testable actions).
- [x] Background transform/opacity changes are persisted in `plan` state (not transient UI state).
- [x] Rectangle authoring interactions (pan/zoom/select/drag/create/resize) still work with background enabled.

## Notes / formulation
Scope is intentionally limited:
- no rotation
- no perspective/warping
- no multi-image support
- no upload flow yet (use existing local/sample source path)

Prefer reducer actions + pure transform helpers over ad-hoc canvas state mutations.

## Implementation notes
- Added real background image rendering in the canvas using `plan.background.source`, `transform`, and `opacity` (with image load/fallback states).
- Added explicit toolbar controls for:
  - opacity up/down
  - x/y nudge (left/right/up/down)
  - uniform scale up/down
- Added plan reducer actions to persist background changes:
  - `plan/background/setOpacity`
  - `plan/background/nudge`
  - `plan/background/scaleUniform`
- Copied the reference image into the served app root (`app/apartment1.png`) so the default persisted source path loads correctly in the browser.
- User feedback polish: background controls are now in a collapsible disclosure to reduce toolbar footprint.
- Manual browser verification passed (user): background controls + rectangle interactions + autosave persistence all work.

## Log (append-only)
- 2026-02-26 11:31: Ticket created for S002 committed backlog.
- 2026-02-26 12:27: Implementation wired (render + controls + persisted reducer actions); awaiting manual smoke-check before DONE.
- 2026-02-26 12:44: User reported T-0007 behavior works and requested smaller BG toolbar footprint. Added collapsible BG controls, then marked DONE.
