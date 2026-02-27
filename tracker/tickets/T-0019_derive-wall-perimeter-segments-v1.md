# T-0019: Derive wall/perimeter segments v1 from authored rectangles

Created: 2026-02-26
Estimate: 5 points
Owner: simonas
Status history (append-only):
- 2026-02-26: OPEN

## Goal
Compute explainable derived wall/perimeter geometry from room+wall shells and introduce shared-boundary contact semantics so connected rooms behave like one plan, not floating rectangles.

## Acceptance criteria
- [ ] Derived geometry helper(s) produce wall shell and segment outputs from authored room interiors + `wallCm`.
- [ ] Output is deterministic and debuggable (not just a single number).
- [ ] Contact-based shared-boundary detect/prune works for adjacent room shells.
- [ ] Pure helper tests cover simple, adjacent, and detached scenarios.
- [ ] Derived geometry is separated from authoring primitives (no direct mutation of plan rectangles).
- [ ] Current editor interactions remain responsive when derived geometry recomputes.

## Notes / formulation
This is a v1 foundation ticket, not the final estimator.

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
(fill in after completion)

## Log (append-only)
- 2026-02-26 19:xx: Ticket created for S005 committed backlog to prioritize perimeter work ahead of magnetic links.
