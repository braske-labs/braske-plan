# T-0009: Scale calibration (reference line -> meters)

Created: 2026-02-26
Estimate: 3 points
Owner: simonas
Status history (append-only):
- 2026-02-26: OPEN
- 2026-02-26: IN_PROGRESS

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
- Added pure scale math helpers in `app/src/editor/geometry/scale.js` (`distanceBetweenWorldPoints`, `computeMetersPerWorldUnit`, `buildScaleCalibration`).
- Added persisted reducer action `plan/scale/setCalibration` in `app/src/editor/state/plan.js`.
- Added `Calibrate Scale` tool mode and calibration draft interaction state in `app/src/editor/state/editor-ui.js`.
- Runtime flow (`app/src/editor/runtime.js`) now supports:
  - drag two-point calibration line in canvas
  - prompt for real-world length in meters on pointer release
  - plan scale persistence (`plan.scale.metersPerWorldUnit` + `referenceLine`)
  - canvas rendering of saved reference line and draft line
  - scale readouts in toolbar/status/overlay
- Manual smoke-check steps added in `app/README.md`.

## Log (append-only)
- 2026-02-26 11:31: Ticket created as S002 stretch backlog.
- 2026-02-26 14:10: Started implementation after adding test harness ticket (`T-0011`).
- 2026-02-26 14:10: Implemented calibration tool + persisted scale model updates; pending manual browser verification.
- 2026-02-26 14:xx: Carried over to S003 as open work (status remains IN_PROGRESS pending manual verification and closeout).
