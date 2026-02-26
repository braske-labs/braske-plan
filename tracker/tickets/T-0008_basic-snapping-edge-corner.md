# T-0008: Basic snapping (edge/corner alignment only)

Created: 2026-02-26
Estimate: 3 points
Owner: simonas
Status history (append-only):
- 2026-02-26: OPEN

## Goal
Speed up tracing by snapping rectangle edits to nearby rectangle edges/corners, without introducing persistent constraints.

## Acceptance criteria
- [ ] Dragging a rectangle can snap to nearby rectangle edges/corners within a defined tolerance.
- [ ] Resizing a rectangle can snap the active edge/corner to nearby rectangle edges/corners within the same tolerance.
- [ ] Snap tolerance is defined in screen pixels and converted via camera zoom (consistent feel across zoom levels).
- [ ] Snapping logic is implemented in pure helper functions (candidate generation + chosen snap result).
- [ ] No magnetic link persistence/unlink behavior is introduced in this ticket.

## Notes / formulation
Scope limits for manageability:
- no persistent constraint graph/model
- no “linked movement” after snapping
- no openings/room-tag-aware snapping
- draw-create snapping is optional (can be deferred if it risks ticket size)

If visual guides are added, keep them lightweight and derived from transient editor state.

## Implementation notes
(fill in after completion)

## Log (append-only)
- 2026-02-26 11:31: Ticket created for S002 committed backlog.
