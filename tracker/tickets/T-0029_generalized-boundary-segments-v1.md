# T-0029: Generalized boundary segments v1 (baseboard + paint foundation)

Created: 2026-03-01
Estimate: 5 points
Owner: simonas
Status history (append-only):
- 2026-03-01: OPEN

## Goal
Create one canonical boundary-segment model that can power both baseboard calculations and paint-surface calculations.

## Acceptance criteria
- [ ] Add a derived segment model with explicit fields: `roomId`, `rectangleId`, `side`, `start/end`, `lengthWorld`, `kind`.
- [ ] Classify segments into at least: `interior_perimeter`, `opening`, `excluded`, `debug_only`.
- [ ] Existing baseboard totals are computed from this model (no behavior regression).
- [ ] Exported debug payload includes derived boundary segments for repro.

## Notes / formulation
- This ticket is infrastructure: one geometry truth for linear quantities.
- Keep segment math independent of UI to stay testable.

## Implementation notes
- Pending.

## Log (append-only)
- 2026-03-01 13:xx: Ticket created from planning discussion (paint + openings + perimeter reuse).
