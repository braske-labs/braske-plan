# T-0024: Multi-rectangle room composition v1

Created: 2026-02-28
Estimate: 3 points
Owner: simonas
Status history (append-only):
- 2026-02-28: OPEN

## Goal
Allow multiple rectangles to be composed into one logical room so L-shapes and split room interiors can be represented without hacks.

## Acceptance criteria
- [ ] User can select multiple room rectangles and assign all to one room in one action.
- [ ] Existing room tags (name/type) remain stable when adding/removing rectangles from that room.
- [ ] Room membership persists in `entities.rooms[*].rectangleIds` and rectangle `roomId`.
- [ ] Converting any member rectangle to `wallRect` removes it from room membership safely.

## Notes / formulation
- Keep v1 simple: composition only, no advanced merge/split UI choreography.
- Must preserve current single-rectangle flow as a subset.

## Implementation notes
- Pending.

## Log (append-only)
- 2026-02-28 13:xx: Ticket created for S006 committed backlog.
