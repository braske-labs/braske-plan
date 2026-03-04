# T-0040: Quote model v2 — estimate grouping and global rates UI

Created: 2026-03-02
Estimate: 2 points
Owner: simonas
Status history (append-only):
- 2026-03-02: OPEN
- 2026-03-02: IN PROGRESS
- 2026-03-02: DONE

## Goal
Ship estimate panel controls for grouping mode and globally editable rates/catalog defaults.

## Acceptance criteria
- [x] Estimate panel has grouping toggle (`Group: Room` / `Group: Job`).
- [x] Estimate body renders both grouping views from the same quote inputs.
- [x] Quote settings section allows editing:
  - baseboard material/work per m,
  - flooring/painting material/work per m²,
  - switch/lamp/door unit prices.
- [x] New flooring and painting types can be added from estimate settings.
- [x] Windows stay explicitly free in estimate output.

## Notes / formulation
- Keep estimate transparent with qty, rate, and amount columns in both modes.

## Implementation notes
- Added controls and wiring in:
  - `app/src/ui-shell.js`
  - `app/src/editor/runtime.js`
- Reworked estimate rendering and settings handlers in `buildEstimatePreviewHtml(...)` pipeline.

## Log (append-only)
- 2026-03-02 19:xx: Ticket created from T-0038 split.
- 2026-03-02 20:xx: Group toggle + settings UI + grouped rendering completed.
