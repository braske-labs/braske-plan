# T-0031: Openings v1 (doors/windows hosted on walls)

Created: 2026-03-01
Estimate: 5 points
Owner: simonas
Status history (append-only):
- 2026-03-01: OPEN

## Goal
Add door/window entities that are wall-hosted and can only slide/resize within valid wall spans.

## Acceptance criteria
- [ ] Opening entity model includes host reference, edge/segment reference, offset, width, and type (`door|window`).
- [ ] Opening creation only succeeds on valid wall segments.
- [ ] Dragging an opening is constrained to its host wall span.
- [ ] Resizing opening clamps to min/max and never escapes host wall.
- [ ] Validation warns if host geometry changes and an opening becomes invalid.

## Notes / formulation
- Openings should behave like children of wall segments, not free-floating shapes.
- Opening geometry must be consumable by baseboard/paint exclusions.

## Implementation notes
- Pending.

## Log (append-only)
- 2026-03-01 13:xx: Ticket created from planning discussion (door/window behavior).
