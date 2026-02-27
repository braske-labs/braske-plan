# S004: Dimensions + validation sprint — “trust the measurements”

Dates: 2026-02-26 → 2026-03-05
Goal: Make dimensions understandable and trustworthy, and surface basic geometry issues before estimate work.

## Sprint backlog (committed)
- T-0014 (3 pts): Selected rectangle dimension readouts (world + meters/cm).
- T-0015 (3 pts): On-canvas dimension labels for selected rectangle.
- T-0016 (3 pts): Basic geometry validation status checks.

Committed points: 9

## Stretch backlog
- T-0017 (3 pts): Export/import plan JSON (local file round-trip).

Stretch points: 3

## Notes / estimates (append-only)
- 2026-02-26: S004 starts immediately after S003 closeout. Date overlap is intentional; sprint IDs are the planning boundary.
- 2026-02-26: `T-0014` is intentionally a narrow slice (readouts first, not full annotation UX) to validate unit formatting before on-canvas labels.
- 2026-02-26: `T-0016` should remain simple and fast (clear warnings/status), not a full CAD-grade validator.

## Daily notes (append-only)
- 2026-02-26: Sprint created from S003 closeout. First execution target: `T-0014` (dimension readouts from calibrated scale).
- 2026-02-26: Started `T-0014`. Added selected rectangle world + metric dimension readouts, scale formatting helpers/tests, and UI status/overlay updates; pending manual browser verification.
- 2026-02-26: User manually verified `T-0014` behavior (readouts, live updates, safe no-selection state). Ticket marked DONE. Next target: `T-0015`.
- 2026-02-26: Started `T-0015`. Added on-canvas selected-rectangle width/height labels (screen-space, metric/world fallback, leader lines) and T-0015 smoke-check steps; pending manual verification.
- 2026-02-26: User manually verified `T-0015` label behavior (visibility, pan/zoom legibility, live drag/resize updates). Ticket marked DONE. Next target: `T-0016`.
- 2026-02-26: Started `T-0016`. Added pure basic-validation helper/tests (missing scale, overlap, invalid geometry, duplicate IDs) and UI validation summaries in debug/status/overlay; pending manual verification.
- 2026-02-26: User manually verified `T-0016` validation behavior (missing-scale + overlap warnings) and responsiveness. Ticket marked DONE. Next target: `T-0017` (stretch).
- 2026-02-26: Started `T-0017` (stretch). Added local JSON export/import toolbar controls, import via existing plan migration path, file I/O status messages, and T-0017 smoke-check steps; pending manual verification.
- 2026-02-26: User manually verified `T-0017` JSON export/import round-trip and invalid-file safety. Ticket marked DONE. S004 scope complete; sprint closed.

## Review (append-only)
### Shipped
- T-0014 (3 pts): Selected rectangle dimension readouts (world + meters/cm).
- T-0015 (3 pts): On-canvas dimension labels for selected rectangle.
- T-0016 (3 pts): Basic geometry validation status checks.
- T-0017 (3 pts, stretch): Export/import plan JSON local round-trip.
- Actual shipped points: 12 (9 committed + 3 stretch).

### Missed / deferred
- None.

### Lessons / changes
- Dimension and validation slices were a useful confidence layer before perimeter-focused work.
- Keeping pure helpers + browser test harness reduced risk while interaction code changed.
