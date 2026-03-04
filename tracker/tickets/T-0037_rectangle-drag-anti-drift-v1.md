# T-0037: Rectangle drag anti-drift v1 (deadzone + 1cm quantized movement)

Created: 2026-03-02
Estimate: 3 points
Owner: simonas
Status history (append-only):
- 2026-03-02: OPEN
- 2026-03-02: IN PROGRESS
- 2026-03-02: DONE

## Goal
Prevent accidental micro-moves and hard-to-recover one-pixel drift when clicking or dragging single and merged room geometry.

## Acceptance criteria
- [x] Clicking a rectangle without meaningful movement does not change rectangle geometry.
- [x] Rectangle drag starts only after pointer movement exceeds a small screen deadzone.
- [x] Dragged rectangle/group movement is quantized to 1cm in metric space (converted to world units from current scale).
- [x] Quantized movement applies consistently to merged-room group drag (one shared delta).
- [x] Existing snapping behavior still applies after quantization.

## Notes / formulation
- Use drag deadzone in screen space (px) to avoid accidental movement on click.
- Quantization should be stable regardless of zoom level (world-space step derived from scale).

## Implementation notes
- Extended rectangle drag interaction payload with:
  - drag start screen anchor,
  - drag start rectangle geometry snapshots for full drag group.
- Added deadzone gate (`5px`) before any geometry movement is applied.
- Added world-space quantization derived from scale (`1cm / metersPerWorldUnit`) with stable anchor quantization so returning near origin returns to exact snapped anchor.
- Group drag now applies one quantized delta from start snapshots across all room-member rectangles, then runs existing snapping.

## Log (append-only)
- 2026-03-02 15:xx: Ticket created from anti-drift request.
- 2026-03-02 15:xx: Implemented deadzone + 1cm quantized drag for single and grouped room rectangles.
