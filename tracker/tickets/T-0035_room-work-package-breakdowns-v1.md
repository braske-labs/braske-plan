# T-0035: Room work-package breakdowns v1 (baseboard/flooring/painting/electricity)

Created: 2026-03-01
Estimate: 5 points
Owner: simonas
Status history (append-only):
- 2026-03-01: OPEN
- 2026-03-01: IN PROGRESS
- 2026-03-01: DONE

## Goal
Expose room-level quantity breakdowns needed for pricing preparation in explicit work-package sections.

## Acceptance criteria
- [x] Baseboard section lists intervals/segments for active room.
- [x] Flooring section shows area and placeholder for material type.
- [x] Painting section shows per-wall area rows (room boundary segment level).
- [x] Electricity section shows switches/lamps/groups/links with group breakdown.
- [x] Electricity section flags obvious incompleteness (e.g., lamps without control or switches with no links).

## Notes / formulation
- v1 can use fixed default wall height for painting preview until configurable wall-height ticket is implemented.
- Keep formulas transparent and traceable in UI.

## Implementation notes
- Baseboard section now enumerates derived room segments.
- Flooring section exposes area and keeps material as v1 placeholder.
- Painting section computes per-segment area with default 2.7m wall height (preview mode).
- Electricity section includes:
  - grouped lamp inventory,
  - ungrouped lamp count,
  - integrity notes for switches with no links / lamps with no control.

## Log (append-only)
- 2026-03-01 20:xx: Ticket created from pricing-prep discussion.
- 2026-03-01 21:xx: Implemented v1 room work-package readouts in sidebar details.
