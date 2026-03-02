# T-0025: Baseboard exclusion rules v1 (room type)

Created: 2026-02-28
Estimate: 5 points
Owner: simonas
Status history (append-only):
- 2026-02-28: OPEN
- 2026-03-02: DONE

## Goal
Apply room-type exclusion rules to counted baseboard totals (starting with bathroom/toilet), while keeping debug visibility explainable.

## Acceptance criteria
- [x] Counted baseboard length excludes configured room types (at least `bathroom`, `toilet`).
- [x] Debug overlay can show both raw candidates and post-exclusion counted segments.
- [x] Status/readout reports raw length, excluded length, and counted length.
- [x] Exclusion logic is deterministic for multi-rectangle rooms.

## Notes / formulation
- This ticket targets quantity correctness, not pricing.
- Rule source can start as hardcoded allow/deny list and be moved to config later.

## Implementation notes
- Added room-type exclusion split in baseboard derivation (`raw` vs `counted` vs `excluded` segments).
- Default exclusion set is `bathroom`, `toilet`, with overridable options input.
- Debug overlay now renders counted segments (red) and excluded segments (amber dashed).
- Status/overlay readouts now expose counted/raw/excluded segment + length summaries.
- Added baseboard tests for exclusion correctness and multi-rectangle deterministic behavior.

## Log (append-only)
- 2026-02-28 13:xx: Ticket created for S006 committed backlog.
- 2026-03-02 14:xx: Completed room-type exclusion logic and debug/readout updates.
