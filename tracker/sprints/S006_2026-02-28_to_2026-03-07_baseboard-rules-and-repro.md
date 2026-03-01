# S006: Baseboard rules + repro sprint — “from debug lines to trusted totals”

Dates: 2026-02-28 → 2026-03-07
Goal: Convert baseboard debug geometry into reliable quantity behavior with room semantics and reproducible exports.
Status: CLOSED on 2026-03-01 (scope pivot; carry-over moved to backlog/new sprint)

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
- 2026-02-28: Completed `T-0024` with explicit merge workflow (`Merge Room` tool), dissolve action, and seam-lock enforcement for full shared same-room boundaries.
- 2026-02-28: Follow-up refinement to `T-0024`: merged-room group drag, topology-preserving edit guard, and optional internal seam sliding toggle (default locked).
- 2026-02-28: Added room navigator sidebar + room color coding (list activation from canvas click, double-click centering, room area/baseboard details).
- 2026-02-28: Updated sidebar to include fallback entries for unassigned roomRects so every roomRect is visible in room navigation.

## Review (append-only)
### Shipped
- `T-0024` multi-rectangle room composition v1 (merge tool + dissolve + seam locks).

### Missed / deferred
- `T-0025` baseboard exclusion rules v1 (still OPEN).
- `T-0026` derived baseboard snapshot export v1 (still OPEN).
- `T-0027` closure diagnostics v1 (still OPEN).
- `T-0028` overlap conflict visualizer v1 (still OPEN).

### Lessons / changes
- 2026-03-01: Sidebar/lighting workflow needs to be stabilized before continuing baseboard-rule refinements.
- 2026-03-01: Keep remaining S006 tickets in backlog and pick them explicitly in a later sprint to avoid hidden WIP.
