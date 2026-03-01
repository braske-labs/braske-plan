# T-0030: Paint quantities v1 (wall height + net paintable area)

Created: 2026-03-01
Estimate: 5 points
Owner: simonas
Status history (append-only):
- 2026-03-01: OPEN

## Goal
Compute paintable wall area from boundary segments using configurable wall height and exclusions.

## Acceptance criteria
- [ ] Add plan-level wall height setting (meters, positive finite).
- [ ] Compute gross wall area as `eligible perimeter length * wall height`.
- [ ] Subtract opening areas (doors/windows) when opening model is present; show placeholder warning if openings are missing.
- [ ] Show room-level and plan-level paint area readouts with unit labels (`m²`).

## Notes / formulation
- Use `T-0029` segment model as source for perimeter length.
- Keep formulas transparent in UI (show length, height, subtraction, net).

## Implementation notes
- Pending.

## Log (append-only)
- 2026-03-01 13:xx: Ticket created from planning discussion (paint cost readiness).
