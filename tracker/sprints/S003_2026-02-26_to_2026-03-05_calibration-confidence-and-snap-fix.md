# S003: Calibration + confidence sprint — “close the loop”

Dates: 2026-02-26 → 2026-03-05
Goal: Finish calibration, add test confidence, and resolve the deferred snapping regression.

## Sprint backlog (committed)
- T-0009 (3 pts, carry-over open): Scale calibration (reference line -> meters).
- T-0011 (2 pts, carry-over open): Pure geometry/reducer unit tests (browser harness).
- T-0012 (2 pts, carry-over open): Fix side-touch drag `top-top` snapping regression.

Committed points: 7

## Stretch backlog
- (none yet)

Stretch points: 0

## Notes / estimates (append-only)
- 2026-02-26: S003 starts immediately after S002 early close. Date overlap is intentional for historical continuity; sprint IDs are the source of truth.
- 2026-02-26: `T-0009` and `T-0011` are implementation-complete enough to focus first on manual verification + closeout before adding new scope.
- 2026-02-26: `T-0012` should be fixed with a regression test in the `T-0011` harness before any new snapping enhancements.

## Daily notes (append-only)
- 2026-02-26: Sprint created from S002 early close. Carry-over tickets entered as open work: `T-0009`, `T-0011`, `T-0012`.
- 2026-02-26: Suggested execution order: run `/tests/` and T-0009 smoke-check, close those tickets, then fix `T-0012`.
- 2026-02-26: Started `T-0012`. Patched drag snap single-axis selection to avoid zero-delta maintained-contact candidates blocking side-touch `top-top` / `bottom-bottom` alignment snaps; added regression tests in `T-0011` harness. Pending manual verification.
- 2026-02-26: `T-0012` manually verified by user after follow-up drag-path patch (raw dual-axis candidate composition). Ticket marked DONE.

## Review (append-only)
### Shipped
- (append at end of sprint)

### Missed / deferred
- (append at end of sprint)

### Lessons / changes
- (append at end of sprint)
