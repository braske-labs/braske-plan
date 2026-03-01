# S007: Room inventory + pricing prep sprint

Dates: 2026-03-01 → 2026-03-08
Goal: Make the left sidebar a practical room inventory with expandable work packages for quantity review before pricing.
Status: OPEN

## Sprint backlog (committed)
- T-0033 (2 pts): Geometry freeze lock v1.
- T-0034 (3 pts): Room inventory sidebar v1.
- T-0035 (5 pts): Room work-package breakdowns v1.

Committed points: 10

## Stretch backlog
- T-0025 (5 pts): Baseboard exclusion rules v1.
- T-0026 (3 pts): Derived baseboard snapshot export v1.

Stretch points: 8

## Notes / estimates (append-only)
- 2026-03-01: Freeze lock is included as a guardrail so quantity editing can proceed without accidental geometry drift.
- 2026-03-01: Sidebar work is intentionally readout-focused first (data visibility before pricing formulas/catalog).
- 2026-03-01: Painting is a preview readout in this sprint; configurable wall-height remains in T-0030.

## Daily notes (append-only)
- 2026-03-01: Sprint created after closing S006 with carry-over backlog preserved.
- 2026-03-01: T-0033 implemented (geometry freeze lock).
- 2026-03-01: Started T-0034/T-0035 implementation (nested room inventory + work-package sections).
- 2026-03-01: Completed T-0034 (room inventory sidebar v1).
- 2026-03-01: Completed T-0035 (room work-package breakdowns v1).

## Review (append-only)
### Shipped
- T-0033 geometry freeze lock v1.
- T-0034 room inventory sidebar v1.
- T-0035 room work-package breakdowns v1.

### Missed / deferred
- 

### Lessons / changes
- Keep inventory package sections collapsible; long segment lists should never take over the full panel.
