# S007: Room inventory + pricing prep sprint

Dates: 2026-03-01 → 2026-03-08
Goal: Make the left sidebar a practical room inventory with expandable work packages for quantity review before pricing.
Status: CLOSED on 2026-03-02 (committed + stretch completed; follow-on openings/paint pulled forward)

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
- 2026-03-02: Completed stretch T-0025 (baseboard exclusions by room type).
- 2026-03-02: Completed stretch T-0026 (derived baseboard snapshot export + docs/tests).
- 2026-03-02: Pulled ahead and completed T-0031 openings v1 and T-0030 paint quantities v1.

## Review (append-only)
### Shipped
- T-0033 geometry freeze lock v1.
- T-0034 room inventory sidebar v1.
- T-0035 room work-package breakdowns v1.
- T-0025 baseboard exclusions by room type v1.
- T-0026 export derived baseboard snapshot v1.
- T-0031 openings v1 (wall-hosted + constrained slide/resize).
- T-0030 paint quantities v1 (wall-height + opening subtraction).

### Missed / deferred
- 

### Lessons / changes
- Keep inventory package sections collapsible; long segment lists should never take over the full panel.
- Derived export payloads are useful for repro, but must remain non-canonical on import.
