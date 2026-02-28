# T-0019: Derive wall/perimeter segments v1 from authored rectangles

Created: 2026-02-26
Estimate: 5 points
Owner: simonas
Status history (append-only):
- 2026-02-26: OPEN
- 2026-02-27: IN_PROGRESS (v1a baseboard candidate extraction + debug overlay toggle)
- 2026-02-28: IN_PROGRESS (v1b interval-based support + shared-boundary pruning + open-side diagnostics)

## Goal
Compute explainable derived wall/perimeter geometry from room + wall authoring and make candidate baseboard segments visible early so algorithm bugs can be inspected quickly.

## Acceptance criteria
- [x] Derived geometry helper(s) produce first-pass baseboard candidate segments from authored room interiors + wall data (`wallCm` and/or touching `wallRect`).
- [x] Output is deterministic and debuggable (segment list + totals, not just a single number).
- [x] A UI debug toggle can draw counted segments as fat red lines for inspection.
- [x] Pure helper tests cover simple and wall-supported scenarios.
- [x] Derived geometry is separated from authoring primitives (no direct mutation of plan rectangles).
- [x] Contact-based shared-boundary detect/prune for adjacent room shells is implemented.
- [x] Enclosure/coverage checks for “room is fully walled” are implemented (first-pass unsupported-open-side interval diagnostics).
- [ ] Current editor interactions remain responsive when derived geometry recomputes.

## Notes / formulation
This is a v1 foundation ticket, not the final estimator.
Execution order is intentionally changed to surface candidate outputs earlier:
- v1a: candidate segment extraction + red debug overlay (implemented first)
- v1b: shared-boundary pruning + enclosure checks

Scope limits:
- no doors/windows exclusions yet
- no room-type exclusions yet
- no pricing logic
- no persistent magnetic-link solver dependencies

Reference behavior/spec:
- `docs/wall_piece_and_shared_boundary_spec.md`

Prefer an intermediate segment model that can later support:
- exclusions (openings)
- room-rule filtering
- debug overlays

## Implementation notes
- Added `app/src/editor/geometry/baseboards.js` with pure helper `deriveBaseboardCandidates(plan)`.
- Integrated candidate recomputation cache and UI readouts in `app/src/editor/runtime.js`.
- Added `Baseboard Debug` toolbar toggle and fat red segment overlay rendering in canvas runtime.
- Added unit tests in `app/tests/specs/baseboards.test.js`.
- v1b update:
  - support is interval-first (full-side for `wallCm` or partial overlap intervals for touching `wallRect`), avoiding full-side boolean overcount.
  - a side with no direct wall can inherit support intervals from a touching opposite side that does have wall support (`neighborWall` source).
  - shared boundaries include overlap-level support metadata and same-room overlap pruning.
  - uncovered/open side intervals are emitted as `unsupportedOpenSides[]` for enclosure diagnostics.
  - candidate vs kept totals are explicit (`candidateTotalLength*`, `prunedLength*`).

## Log (append-only)
- 2026-02-26 19:xx: Ticket created for S005 committed backlog to prioritize perimeter work ahead of magnetic links.
- 2026-02-27 12:xx: Re-scoped with user feedback: prioritize candidate visibility and bug-finding before closure/coverage semantics.
- 2026-02-27 12:xx: Implemented v1a candidate extraction + debug red overlay toggle; proceeding to v1b next.
- 2026-02-28 10:xx: Implemented v1b interval-first pass (partial wall support intervals, shared-boundary seam pruning, and open-side diagnostics).
