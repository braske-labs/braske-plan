# T-0034: Room inventory sidebar v1

Created: 2026-03-01
Estimate: 3 points
Owner: simonas
Status history (append-only):
- 2026-03-01: OPEN
- 2026-03-01: IN PROGRESS
- 2026-03-01: DONE

## Goal
Turn the left sidebar into a compact room inventory that shows room-level quantities and allows fast drill-down.

## Acceptance criteria
- [x] Each room row shows compact quantity cues (rectangles + core lighting counts).
- [x] Active room details are organized into nested sections (expand/collapse).
- [x] Room section includes at least: baseboard, flooring, painting, electricity.
- [x] Lighting groups are listed under electricity for the selected room.
- [x] Layout remains compact and scrollable.

## Notes / formulation
- Keep authored geometry unchanged (rectangles remain canonical).
- This is a UI/derived-readout ticket; no schema changes required.

## Implementation notes
- Sidebar room rows now include `S/L/G` compact stats.
- Room details panel now uses expandable work-package sections with scroll containment.

## Log (append-only)
- 2026-03-01 20:xx: Ticket created from room-inventory UX request.
- 2026-03-01 21:xx: Implemented compact room-row stats and nested room package sections in left sidebar.
