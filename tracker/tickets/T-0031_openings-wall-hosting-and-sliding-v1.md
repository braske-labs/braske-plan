# T-0031: Openings v1 (doors/windows hosted on walls)

Created: 2026-03-01
Estimate: 5 points
Owner: simonas
Status history (append-only):
- 2026-03-01: OPEN
- 2026-03-02: DONE

## Goal
Add door/window entities that are wall-hosted and can only slide/resize within valid wall spans.

## Acceptance criteria
- [x] Opening entity model includes host reference, edge/segment reference, offset, width, and type (`door|window`).
- [x] Opening creation only succeeds on valid wall segments.
- [x] Dragging an opening is constrained to its host wall span.
- [x] Resizing opening clamps to min/max and never escapes host wall.
- [x] Validation warns if host geometry changes and an opening becomes invalid.

## Notes / formulation
- Openings should behave like children of wall segments, not free-floating shapes.
- Opening geometry must be consumable by baseboard/paint exclusions.

## Implementation notes
- Added opening reducer actions (`add/move/resize/delete`) with host-side projection + clamping.
- Added tools (`Place Door`, `Place Window`), constrained drag/resize interactions, and delete action.
- Added opening render/hit-testing, import normalization (including legacy `host.edge`), and validation findings.
- Added reducer coverage for add/move/reproject + invalidation behavior.

## Log (append-only)
- 2026-03-01 13:xx: Ticket created from planning discussion (door/window behavior).
- 2026-03-02 14:xx: Implemented wall-hosted openings v1 end-to-end (authoring, constraints, validation, persistence).
