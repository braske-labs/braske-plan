# T-0038: Quote model v2 (estimate grouping + price catalog + room package assignments)

Created: 2026-03-02
Estimate: 8 points
Owner: simonas
Status history (append-only):
- 2026-03-02: OPEN
- 2026-03-02: IN PROGRESS
- 2026-03-02: SPLIT into T-0039/T-0040/T-0041/T-0042
- 2026-03-02: DONE

## Goal
Upgrade estimate from fixed demo rates to a configurable quote model that supports:
- estimate view grouping by **Room** or **Job package**,
- editable pricing inputs,
- room-specific package enable/disable and material selections,
- fixture-level lighting product assignment,
- door costing and explicit free windows.

## Acceptance criteria
- [x] Estimate preview has a clear toggle: `Group by Room` / `Group by Job`.
- [x] Global pricing editor exists for default unit rates (material + work where relevant).
- [x] Flooring supports multiple types (e.g. laminate, tiles), each with separate material/work rates per m².
- [x] Each room can choose flooring type; room estimate uses selected type rates.
- [x] Each room can enable/disable baseboard inclusion in quote without changing geometry.
- [x] Painting supports selectable wall finish profile (material + work rates per m²).
- [x] Lighting supports catalog assignment: each switch/lamp can reference a priced product entry.
- [x] Door openings contribute quote lines with configurable unit cost; windows always contribute zero cost.
- [x] Estimate math remains transparent (qty × rate lines + subtotals + totals) in both grouping modes.
- [x] Existing quantity calculations remain source-of-truth (baseboard/flooring/painting/electricity quantities unchanged).

## Notes / formulation
- This is pricing/model/UI work; geometry algorithms are not changed by this ticket.
- Windows are explicitly non-billable (`0`) in quote output.
- Since scope is broad, implementation can be done in slices under this ticket while keeping model-compatible output.

## Implementation notes
Implemented via child tickets:
- T-0039: quote schema + persistence + product-id wiring.
- T-0040: grouped estimate view + quote settings editor.
- T-0041: room-level quote controls in room inventory.
- T-0042: pricing math/tests alignment and closeout polish.

## Log (append-only)
- 2026-03-02 15:xx: Ticket created from estimate-grouping and pricing-model discussion.
- 2026-03-02 19:xx: Scope split to child tickets for delivery slices.
- 2026-03-02 20:xx: Child slices merged; parent closed.
