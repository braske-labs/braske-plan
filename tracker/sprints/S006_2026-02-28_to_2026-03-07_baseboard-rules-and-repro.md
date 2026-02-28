# S006: Baseboard rules + repro sprint — “from debug lines to trusted totals”

Dates: 2026-02-28 → 2026-03-07
Goal: Convert baseboard debug geometry into reliable quantity behavior with room semantics and reproducible exports.
Status: OPEN

## Sprint backlog (committed)
- T-0024 (3 pts): Multi-rectangle room composition v1 (assign selected rectangles into one room ID).
- T-0025 (5 pts): Baseboard exclusion rules v1 (exclude room types like bathroom/toilet from counted totals).
- T-0026 (3 pts): Export derived baseboard snapshot in plan JSON (`derived.baseboards`) for deterministic bug repro.

Committed points: 11

## Stretch backlog
- T-0027 (3 pts): Geometry closure diagnostics v1 (flag open shells / disconnected enclosure segments).
- T-0028 (3 pts): Baseboard overlap conflict visualizer (flash conflicting counted segments separately from overlap warnings).

Stretch points: 6

## Notes / estimates (append-only)
- 2026-02-28: Keep magnetic/sticky linking deferred; priority remains fast perimeter/baseboard correctness.
- 2026-02-28: `T-0025` is highest product-value slice because it connects room tags to actual counted output.
- 2026-02-28: `T-0026` is explicitly debug-focused; import should still recompute derived values from canonical geometry.

## Daily notes (append-only)
- 2026-02-28: Sprint drafted after S005 closeout correction. Planned execution order: `T-0024` → `T-0025` → `T-0026`.

## Review (append-only)
### Shipped
-  

### Missed / deferred
-  

### Lessons / changes
-  
