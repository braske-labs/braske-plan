# T-0009: Scale calibration (reference line -> meters)

Created: 2026-02-26
Estimate: 3 points
Owner: simonas
Status history (append-only):
- 2026-02-26: OPEN

## Goal
Convert drawing/world units into meters by calibrating against a user-defined reference line.

## Acceptance criteria
- [ ] User can define a reference line in the editor (two points) for calibration.
- [ ] User can enter the real-world length for that line (meters).
- [ ] App stores `plan.scale.metersPerWorldUnit` and the reference line in `plan.scale`.
- [ ] Current scale is visible in the UI (readout/debug display is fine for this ticket).
- [ ] Recalibrating replaces the previous scale cleanly.

## Notes / formulation
This ticket is about a correct, testable calibration path, not polished estimating outputs yet.

Scope limits:
- no quantity/cost calculations in this ticket
- no unit system switching beyond meters
- no advanced measurement toolset beyond calibration line creation

Prefer pure math helpers for calibration calculation and line length conversion.

## Implementation notes
(fill in after completion)

## Log (append-only)
- 2026-02-26 11:31: Ticket created as S002 stretch backlog.
