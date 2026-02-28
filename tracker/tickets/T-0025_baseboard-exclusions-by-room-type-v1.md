# T-0025: Baseboard exclusion rules v1 (room type)

Created: 2026-02-28
Estimate: 5 points
Owner: simonas
Status history (append-only):
- 2026-02-28: OPEN

## Goal
Apply room-type exclusion rules to counted baseboard totals (starting with bathroom/toilet), while keeping debug visibility explainable.

## Acceptance criteria
- [ ] Counted baseboard length excludes configured room types (at least `bathroom`, `toilet`).
- [ ] Debug overlay can show both raw candidates and post-exclusion counted segments.
- [ ] Status/readout reports raw length, excluded length, and counted length.
- [ ] Exclusion logic is deterministic for multi-rectangle rooms.

## Notes / formulation
- This ticket targets quantity correctness, not pricing.
- Rule source can start as hardcoded allow/deny list and be moved to config later.

## Implementation notes
- Pending.

## Log (append-only)
- 2026-02-28 13:xx: Ticket created for S006 committed backlog.
