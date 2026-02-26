# T-0015: On-canvas dimension labels for selected rectangle

Created: 2026-02-26
Estimate: 3 points
Owner: simonas
Status history (append-only):
- 2026-02-26: OPEN
- 2026-02-26: IN_PROGRESS
- 2026-02-26: DONE

## Goal
Render clear width/height labels near the selected rectangle on the canvas so dimensions are visible without reading debug/status text.

## Acceptance criteria
- [x] Selected rectangle shows width/height labels on canvas.
- [x] Labels use calibrated meters/cm when scale exists; otherwise world units fallback is explicit.
- [x] Labels remain legible during pan/zoom and do not break drag/resize interactions.
- [x] Labels update live during drag/resize.
- [x] No significant performance regression in normal tracing use.

## Notes / formulation
Keep this ticket focused on selected-rectangle labels only.

Scope limits:
- no full dimensioning tool
- no persistent/manual dimension annotations
- no multi-select label layouts

## Implementation notes
- Added screen-space on-canvas dimension labels for selected rectangle in `app/src/editor/runtime.js`:
  - width label (`W ...`) near top/bottom edge center
  - height label (`H ...`) near left/right edge center
- Labels use calibrated meters/cm when scale exists; otherwise explicit `wu` fallback.
- Labels are rendered in screen space (constant font size) with leader lines so they remain legible during pan/zoom.
- Added placement fallback logic to avoid overlapping the top-left debug panel and hover coordinate tooltip when possible.
- Updated `app/src/ui-shell.js` copy/status text and `app/README.md` with a T-0015 manual smoke checklist.

## Log (append-only)
- 2026-02-26 19:xx: Ticket created for S004 committed backlog.
- 2026-02-26 20:xx: Started implementation. Added on-canvas selected-rectangle width/height labels (screen-space, live updates) with metric/world fallback formatting. Pending manual browser verification.
- 2026-02-26 20:xx: User manually verified label visibility, pan/zoom legibility, and live drag/resize updates. Ticket marked DONE.
