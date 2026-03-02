# T-0030: Paint quantities v1 (wall height + net paintable area)

Created: 2026-03-01
Estimate: 5 points
Owner: simonas
Status history (append-only):
- 2026-03-01: OPEN
- 2026-03-02: DONE

## Goal
Compute paintable wall area from boundary segments using configurable wall height and exclusions.

## Acceptance criteria
- [x] Add plan-level wall height setting (meters, positive finite).
- [x] Compute gross wall area as `eligible perimeter length * wall height`.
- [x] Subtract opening areas (doors/windows) when opening model is present; show placeholder warning if openings are missing.
- [x] Show room-level and plan-level paint area readouts with unit labels (`m²`).

## Notes / formulation
- Use `T-0029` segment model as source for perimeter length.
- Keep formulas transparent in UI (show length, height, subtraction, net).

## Implementation notes
- Added persisted plan setting `settings.wallHeightMeters` with reducer action and toolbar controls.
- Painting breakdown now computes gross area, opening subtraction, and net paintable area per segment.
- Room inventory painting rows show subtraction terms where openings overlap boundary segments.
- Rooms totals now include plan-level paint area readout (`m²`).
- Added reducer test for wall-height setting persistence behavior.

## Log (append-only)
- 2026-03-01 13:xx: Ticket created from planning discussion (paint cost readiness).
- 2026-03-02 14:xx: Implemented wall-height setting and opening-aware paint quantity calculation.
