# T-0005: Rectangle selection + drag on Plan Model v0

Created: 2026-02-26
Estimate: 2 points
Owner: simonas
Status history (append-only):
- 2026-02-26: OPEN
- 2026-02-26: IN_PROGRESS
- 2026-02-26: DONE

## Goal
Implement the first rectangle interaction slice (select + drag) on top of the new editor foundation and Plan Model v0.

## Acceptance criteria
- [x] Seeded rectangles render from plan state (not hardcoded canvas draw-only logic).
- [x] Click selects the topmost rectangle.
- [x] Drag moves the selected rectangle.
- [x] Behavior remains responsive and does not fight camera pan.
- [x] Hit-testing / drag math is factored cleanly enough for later resize/snap extensions.

## Notes / formulation
This intentionally excludes:
- rectangle creation,
- resize handles,
- snapping,
- magnetic links.

Those will be separate tickets.

## Implementation notes
- Added pure rectangle interaction helpers:
  - `app/src/editor/geometry/rectangles.js`
  - topmost hit-testing + drag offset/position math
- Added rectangle move action to Plan Model reducer:
  - `app/src/editor/state/plan.js`
  - `plan/rectangles/move`
- Added editor UI selection + rectangle drag interaction state/actions:
  - `app/src/editor/state/editor-ui.js`
- Updated runtime pointer handling in `app/src/editor/runtime.js`:
  - left-click on rectangle -> select + start rectangle drag
  - left-click empty space -> clear selection + pan
  - middle-click -> pan
  - wheel zoom remains cursor-anchored
- Updated renderer and status overlays to show:
  - selected rectangle
  - interaction mode
  - selection highlight outline
- Added manual T-0005 smoke-check steps:
  - `app/README.md`

## Pending manual verification
- Browser interaction check still needed for:
  - topmost selection
  - drag behavior
  - pan/drag conflict behavior

## Manual verification result (append-only)
- 2026-02-26: User confirmed browser smoke-check passed ("commit T5").

## Completion evidence (append-only)
- 2026-02-26: Manual browser verification passed for selection, drag, and pan/drag interaction separation.
- 2026-02-26: Local server response previously verified on `127.0.0.1:4173`.

## Log (append-only)
- 2026-02-26 10:23: Ticket created from T-0002 split.
- 2026-02-26 11:25: Started T-0005 implementation.
- 2026-02-26 11:33: Added pure rectangle hit-test/drag math module and rectangle move plan action.
- 2026-02-26 11:39: Wired selection + rectangle drag into runtime pointer handling and renderer highlights.
- 2026-02-26 11:42: Added manual T-0005 smoke-check steps; awaiting browser verification before marking DONE.
- 2026-02-26 11:45: User confirmed manual smoke-check passed; marked T-0005 done.
