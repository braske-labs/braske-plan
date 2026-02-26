# T-0008: Basic snapping (edge/corner alignment only)

Created: 2026-02-26
Estimate: 3 points
Owner: simonas
Status history (append-only):
- 2026-02-26: OPEN
- 2026-02-26: IN_PROGRESS
- 2026-02-26: DONE

## Goal
Speed up tracing by snapping rectangle edits to nearby rectangle edges/corners, without introducing persistent constraints.

## Acceptance criteria
- [x] Dragging a rectangle can snap to nearby rectangle edges/corners within a defined tolerance.
- [x] Resizing a rectangle can snap the active edge/corner to nearby rectangle edges/corners within the same tolerance.
- [x] Snap tolerance is defined in screen pixels and converted via camera zoom (consistent feel across zoom levels).
- [x] Snapping logic is implemented in pure helper functions (candidate generation + chosen snap result).
- [x] No magnetic link persistence/unlink behavior is introduced in this ticket.

## Notes / formulation
Scope limits for manageability:
- no persistent constraint graph/model
- no “linked movement” after snapping
- no openings/room-tag-aware snapping
- draw-create snapping is optional (can be deferred if it risks ticket size)

If visual guides are added, keep them lightweight and derived from transient editor state.

## Implementation notes
- Added pure snapping helpers in `app/src/editor/geometry/snapping.js` for:
  - rectangle snap target generation
  - axis candidate generation
  - candidate selection/scoring
  - drag/resize snap application
- Runtime integrates snapping into:
  - rectangle drag (`draggingRect`)
  - rectangle resize (`resizingRect`)
- Snap tolerance is defined in screen pixels and converted to world units using camera zoom.
- Snapping remains ephemeral (no persistent links/unlink model).
- Refined snapping rules after manual testing feedback:
  - removed unintended free-space PowerPoint-style alignment snapping
  - contact-only snapping (edge touch with overlap; corner touch allowed)
  - same-edge alignment snapping when rectangles are already touching on the other axis
- Manual browser verification passed (user) after rule refinements.

## Log (append-only)
- 2026-02-26 11:31: Ticket created for S002 committed backlog.
- 2026-02-26 13:02: Implemented basic drag/resize snapping with pure helper module; awaiting manual smoke-check before DONE.
- 2026-02-26 13:20: Fixed snapping bug causing non-contact alignment snapping; restricted to contact-only rules.
- 2026-02-26 13:27: Extended contact snapping to support same-edge alignment while already touching and corner-touch drag/resize cases.
- 2026-02-26 13:34: User verified snapping behavior matches intended contact-only rules. Marked DONE.
