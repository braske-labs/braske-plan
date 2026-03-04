# T-0036: Room visualization toggles v1 (highlight on/off + walls black mode)

Created: 2026-03-02
Estimate: 2 points
Owner: simonas
Status history (append-only):
- 2026-03-02: OPEN
- 2026-03-02: IN PROGRESS
- 2026-03-02: DONE

## Goal
Add quick display toggles so users can switch between colorful room highlighting and neutral technical view while tracing/validating geometry.

## Acceptance criteria
- [x] Toolbar has `Room Highlighting` toggle (`On` by default).
- [x] When `Room Highlighting` is `Off`, all room fills render neutral white/very-light gray (no room color palette), while selection outline still remains visible.
- [x] Toolbar has `Walls Black` toggle (`Off` by default).
- [x] When `Walls Black` is `On`, wall rectangles and wall shell strokes render near-black for high-contrast plan checking.
- [x] Toggle states are reflected in status readout and included in export/import-safe editor UI state (session-level, not plan geometry).

## Notes / formulation
- This is a visualization-only feature. It must not change geometry, room assignments, or quantities.
- Selection and active-room affordances still need to remain readable when highlighting is off.

## Implementation notes
Implemented:
- Added toolbar buttons and control wiring in `app/src/ui-shell.js`.
- Added reducers for `plan/view/toggleRoomHighlighting` and `plan/view/toggleWallsBlack` in `app/src/editor/state/plan.js`.
- Added migration/normalization for `plan.view` in `app/src/editor/persistence/local-plan-storage.js`.
- Applied render-mode styling in `drawDebugRectangles(...)` and status/overlay labels in `app/src/editor/runtime.js`.

## Log (append-only)
- 2026-03-02 15:xx: Ticket created from room-visualization request.
- 2026-03-02 19:xx: Runtime + toolbar + persistence wiring completed.
