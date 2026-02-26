# T-0010: Delete selected rectangle

Created: 2026-02-26
Estimate: 2 points
Owner: simonas
Status history (append-only):
- 2026-02-26: OPEN

## Goal
Let the user remove a mistaken rectangle without resetting the whole plan.

## Acceptance criteria
- [ ] User can delete the currently selected rectangle from the UI (toolbar button and/or keyboard shortcut).
- [ ] Deleting clears selection and leaves editor interaction state consistent.
- [ ] If no rectangle is selected, delete action is a safe no-op.
- [ ] Room references are not left pointing at the deleted rectangle (for current debug/sample data).
- [ ] Autosave persists the deletion through existing `T-0003` flow.

## Notes / formulation
This is a small quality-of-life ticket that reduces friction while tracing.

Scope limits:
- no undo/redo yet
- no multi-select delete
- no delete confirmation modal (MVP)

Prefer one reducer action for rectangle deletion plus any minimal room-reference cleanup required by Plan Model v0 invariants.

## Implementation notes
(fill in after completion)

## Log (append-only)
- 2026-02-26 12:11: Ticket created after user feedback during S002 execution (missing basic delete flow).
