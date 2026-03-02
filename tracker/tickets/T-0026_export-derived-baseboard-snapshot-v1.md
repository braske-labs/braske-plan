# T-0026: Export derived baseboard snapshot v1

Created: 2026-02-28
Estimate: 3 points
Owner: simonas
Status history (append-only):
- 2026-02-28: OPEN
- 2026-03-02: DONE

## Goal
Include optional derived baseboard intervals/segments in exported JSON for deterministic bug reproduction and diffing.

## Acceptance criteria
- [x] Exported plan JSON includes `derived.baseboards` snapshot with segments/intervals and metadata (`algoVersion`, `computedAt`).
- [x] Import path ignores derived snapshot for runtime truth and recomputes from canonical geometry.
- [x] Export snapshot format is documented in a short note.
- [x] At least one regression test covers stable export shape.

## Notes / formulation
- Derived payload is debug aid, not canonical persisted state.
- Keep payload optional and backward-compatible with existing plan version.

## Implementation notes
- Added `deriveBaseboardExportSnapshot` helper with stable metadata/counts/lengths/segments/boundaries payload.
- Export flow now writes `derived.baseboards` alongside existing `derived.lighting`.
- Import/migration path remains canonical-geometry-first and does not trust derived payload.
- Added dedicated snapshot regression test and documentation note.

## Log (append-only)
- 2026-02-28 13:xx: Ticket created for S006 committed backlog.
- 2026-03-02 14:xx: Added derived baseboard export snapshot + tests + docs.
