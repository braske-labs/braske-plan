# T-0010: Delete selected rectangle

Created: 2026-02-26
Estimate: 2 points
Owner: simonas
Status history (append-only):
- 2026-02-26: OPEN
- 2026-02-26: IN_PROGRESS
- 2026-02-26: DONE

## Goal
Let the user remove a mistaken rectangle without resetting the whole plan.

## Acceptance criteria
- [x] User can delete the currently selected rectangle from the UI (toolbar button and/or keyboard shortcut).
- [x] Deleting clears selection and leaves editor interaction state consistent.
- [x] If no rectangle is selected, delete action is a safe no-op.
- [x] Room references are not left pointing at the deleted rectangle (for current debug/sample data).
- [x] Autosave persists the deletion through existing `T-0003` flow.

## Notes / formulation
This is a small quality-of-life ticket that reduces friction while tracing.

Scope limits:
- no undo/redo yet
- no multi-select delete
- no delete confirmation modal (MVP)

Prefer one reducer action for rectangle deletion plus any minimal room-reference cleanup required by Plan Model v0 invariants.

## Implementation notes
- Added `plan/rectangles/delete` reducer action with cleanup of:
  - room `rectangleIds` references (empty rooms removed)
  - openings hosted on the deleted rectangle
- Added `Delete Rect` toolbar button wired to delete the current selection.
- Added keyboard delete support via global `Delete` / `Backspace`.
- `Backspace` now safely prevents browser navigation in the app when used for delete/no-op.
- Deleting clears selection and resets transient interaction state.
- Manual browser verification passed (user), including toolbar + keyboard delete and persisted deletion on reload.

## Log (append-only)
- 2026-02-26 12:11: Ticket created after user feedback during S002 execution (missing basic delete flow).
- 2026-02-26 13:02: Implemented reducer + toolbar + keyboard delete flow; awaiting manual smoke-check before DONE.
- 2026-02-26 13:34: User verified delete flow works correctly (including safe behavior and persistence). Marked DONE.
