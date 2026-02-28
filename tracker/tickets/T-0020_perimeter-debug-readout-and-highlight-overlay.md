# T-0020: Perimeter debug readout + highlight overlay

Created: 2026-02-26
Estimate: 3 points
Owner: simonas
Status history (append-only):
- 2026-02-26: OPEN
- 2026-02-27: OPEN (core red-line toggle landed in T-0019 v1a; this ticket now tracks richer overlay/readout polish)
- 2026-02-28: IN_PROGRESS
- 2026-02-28: DONE (implementation complete; further UX polish can continue separately)

## Goal
Show the derived perimeter/baseboard-candidate result in the UI with a visual overlay so the user can inspect what geometry is being counted.

## Acceptance criteria
- [x] UI shows a perimeter/baseboard-candidate total (pre-exclusion is acceptable for this ticket).
- [x] A debug overlay highlights counted segments on the canvas.
- [x] The displayed total and overlay update after relevant edits.
- [x] Behavior is explainable enough to compare visually against the plan.
- [x] No noticeable regression in editor interactivity for typical tracing use.

## Notes / formulation
This is the first “trustable perimeter output” step, not the final estimate UX.

Current split:
- `T-0019` v1a delivers baseboard candidate extraction + fat red toggle overlay.
- This ticket keeps follow-up overlay/readout improvements (filters, richer diagnostics, UX polish).

Scope limits:
- no pricing/catalog integration
- no exclusions by room/openings yet (unless trivial and already available)
- no report/export formatting

Upstream dependency update:
- `T-0019` v1b now emits richer diagnostics (`sharedBoundaries`, `unsupportedOpenSides`, candidate-vs-kept totals).
- This ticket should surface those diagnostics in the canvas/readout so geometry bugs can be located visually without reading JSON.

## Implementation notes
- Added richer baseboard readouts in status/overlay text (candidate counts and lengths visible during edits).
- Kept red candidate segment overlay in runtime and updated it to track new normalized baseboard outputs.
- Added overlap-pair validation flashing so geometry conflicts are directly locatable while debugging perimeter output.
- Updated validation to emit concrete overlap pairs for runtime diagnostics.

## Log (append-only)
- 2026-02-26 19:xx: Ticket created for S005 committed backlog to surface perimeter results early and visually.
- 2026-02-28 11:xx: Implemented readout/overlay polish and overlap flash diagnostics for explainable geometry debugging.
