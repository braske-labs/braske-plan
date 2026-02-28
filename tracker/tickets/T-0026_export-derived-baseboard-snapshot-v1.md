# T-0026: Export derived baseboard snapshot v1

Created: 2026-02-28
Estimate: 3 points
Owner: simonas
Status history (append-only):
- 2026-02-28: OPEN

## Goal
Include optional derived baseboard intervals/segments in exported JSON for deterministic bug reproduction and diffing.

## Acceptance criteria
- [ ] Exported plan JSON includes `derived.baseboards` snapshot with segments/intervals and metadata (`algoVersion`, `computedAt`).
- [ ] Import path ignores derived snapshot for runtime truth and recomputes from canonical geometry.
- [ ] Export snapshot format is documented in a short note.
- [ ] At least one regression test covers stable export shape.

## Notes / formulation
- Derived payload is debug aid, not canonical persisted state.
- Keep payload optional and backward-compatible with existing plan version.

## Implementation notes
- Pending.

## Log (append-only)
- 2026-02-28 13:xx: Ticket created for S006 committed backlog.
