# T-0018: Per-side wall thickness editing controls (selected rectangle)

Created: 2026-02-26
Estimate: 3 points
Owner: simonas
Status history (append-only):
- 2026-02-26: OPEN
- 2026-02-26: IN_PROGRESS
- 2026-02-27: DONE (implementation complete; manual smoke verification pending)

## Goal
Implement room+wall authoring semantics for selected rectangles so wall thickness is geometry-active (not just stored values), preserving prototype-style behavior needed for perimeter/baseboard logic.

## Acceptance criteria
- [x] When a rectangle is selected, the user can increase/decrease `wallCm.top/right/bottom/left`.
- [x] Values persist in `plan.entities.rectangles[*].wallCm`.
- [x] UI shows the current per-side wall thickness values for the selected rectangle.
- [x] Wall thickness visibly changes derived shell geometry around the room interior (outward per edited side).
- [x] Wall shell geometry is available to snapping/contact logic (not interior-only).
- [x] Editing wall thickness does not break draw/select/drag/resize/snapping flows.
- [x] Safe no-op / disabled UI when no rectangle is selected.

## Notes / formulation
This ticket now covers authoring controls plus geometry-active shell behavior.

Scope limits:
- no derived perimeter math yet (that is `T-0019`)
- no full multi-hop constraint solving between neighboring rectangles
- no wall style presets / bulk edit UX

## Implementation notes
- Added toolbar `Wall Cm` disclosure controls in `app/src/ui-shell.js`:
  - per-side rows for `Top/Right/Bottom/Left`
  - `-` / `+` buttons and current side values
  - selection-aware summary status
- Added wall controls styling in `app/styles.css` (`wall-controls-panel`, `wall-row`, `wall-value`).
- Added reducer support in `app/src/editor/state/plan.js`:
  - `plan/rectangles/setWallCm` updates persisted `wallCm` per side on selected rectangle
  - safe no-op for missing rectangle / invalid side
- Added runtime handlers and state sync in `app/src/editor/runtime.js`:
  - side increment/decrement handlers
  - disabled/no-op behavior with no selection
  - wall values reflected in toolbar summary + status/overlay text
- Added reducer tests in `app/tests/specs/plan-reducer.test.js` for `setWallCm` update/no-op behavior.
- Added wall-shell geometry module in `app/src/editor/geometry/wall-shell.js`:
  - `wallCm` -> world-unit wall thickness conversion
  - interior/outer rect conversion helpers
  - derived shell geometry with wall bands
- Updated editor runtime in `app/src/editor/runtime.js`:
  - wall shell is drawn around room interiors
  - hit-testing includes shell bounds so wall bands are selectable/draggable
  - drag/resize snapping uses outer-shell geometry and converts back to interior geometry
- Added shell-focused tests:
  - `app/tests/specs/wall-shell.test.js`
  - shell-contact drag snapping scenario in `app/tests/specs/snapping.test.js`
- Added/updated `T-0018` manual smoke-check steps in `app/README.md` including shell rendering and shell-contact snapping checks.

## Log (append-only)
- 2026-02-26 19:xx: Ticket created for S005 committed backlog after confirming wall thickness authoring remains required for the intended workflow.
- 2026-02-26 20:xx: Started implementation. Added per-side wall thickness controls and persisted reducer updates; pending manual verification.
- 2026-02-27 10:xx: Re-scoped after prototype review/user feedback: wall thickness must drive room-shell geometry and contact semantics, not remain passive metadata.
- 2026-02-27 11:xx: Completed geometry-active implementation (shell rendering, shell hit-test, shell-based drag/resize snapping). Manual browser smoke checks pending.
