# T-0041: Quote model v2 — room package override controls

Created: 2026-03-02
Estimate: 2 points
Owner: simonas
Status history (append-only):
- 2026-03-02: OPEN
- 2026-03-02: IN PROGRESS
- 2026-03-02: DONE

## Goal
Enable per-room quote overrides directly from room inventory: baseboard include/exclude, flooring type, and painting type.

## Acceptance criteria
- [x] Room inventory details show quote controls per room entry.
- [x] User can toggle `includeBaseboard` without changing geometry/baseboard derivation.
- [x] User can select flooring and painting types per room.
- [x] Room estimate rows use selected room override values.
- [x] Room override changes persist in plan JSON via `plan.quote.roomConfigs`.

## Notes / formulation
- Room overrides are keyed by sidebar room-entry id (`room:*` or `rect:*`), matching existing room inventory identity model.

## Implementation notes
- Added quote controls in `buildRoomInventoryDetailsHtml(...)` in `app/src/editor/runtime.js`.
- Added change-handler wiring in room list delegation for:
  - `data-room-quote-field='includeBaseboard'`
  - `data-room-quote-field='flooringTypeId'`
  - `data-room-quote-field='paintingTypeId'`
- Added supporting styles in `app/styles.css`.

## Log (append-only)
- 2026-03-02 19:xx: Ticket created from T-0038 split.
- 2026-03-02 20:xx: Room quote controls and persistence wiring completed.
