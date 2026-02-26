# T-0013: Multi-constraint snap resolution (preserve active snaps)

Created: 2026-02-26
Estimate: 5 points
Owner: simonas
Status history (append-only):
- 2026-02-26: OPEN

## Goal
Fix drag/resize snapping so the solver can preserve already-valid snaps and add additional compatible snaps, instead of selecting a single snap candidate that may override/block other valid constraints.

## Acceptance criteria
- [ ] Dragging a rectangle while it is already side-touching another rectangle can still snap `top-top` / `bottom-bottom` alignments during vertical motion.
- [ ] Existing valid contact/alignment snaps are preserved while adding new compatible snaps (no unintended unsnapping from snap selection order).
- [ ] Multiple simultaneous snaps are supported (for example: side contact on one axis plus one or more edge alignments on the other axis).
- [ ] Corner snapping still works and does not regress.
- [ ] Resize snapping uses the same constraint-preserving behavior (within handle/min-size rules).
- [ ] Regression coverage added in `T-0011` tests for drag and resize multi-snap cases.

## Notes / formulation
This expands on the narrow regression captured in `T-0012` and addresses the underlying model issue: the current drag/resize snap flow computes candidates per axis, then chooses one "best" result, which can allow a no-op or lower-value snap to block another compatible snap.

Desired behavior:
- Treat snapping as a set of compatible constraints, not a single winner.
- Preserve constraints already satisfied by the current/proposed geometry.
- Add compatible new constraints when within tolerance.
- Do not reintroduce free-space alignment snapping; contact-only rules still apply.

Likely implementation direction (algorithmic):
- Separate "candidate generation" from "constraint selection/application".
- Represent active snaps as a collection (not just one `x` and one `y` candidate).
- For drag: solve translation by applying all compatible axis constraints and keeping the resulting geometry consistent.
- For resize: solve handle-limited constraints (respecting min size and the handle's movable axes).
- Define tie-breaking only when constraints conflict; prefer preserving currently satisfied constraints over replacing them.

## Implementation notes
(fill in after completion)

## Log (append-only)
- 2026-02-26 17:44: Ticket created after user clarified snapping must preserve multiple simultaneous constraints (including already-active snaps) instead of overriding with a single best candidate.
