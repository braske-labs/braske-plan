# T-0023: Room-wall contact normalization v1

Created: 2026-02-28
Estimate: 5 points
Owner: simonas
Status history (append-only):
- 2026-02-28: OPEN
- 2026-02-28: IN_PROGRESS
- 2026-02-28: DONE (implementation complete; follow-up bug tuning may continue)

## Goal

Introduce an explicit intermediate room-wall contact model so baseboard logic operates on normalized side contacts instead of ad-hoc rectangle pair checks.

## Acceptance criteria

- [x] Geometry layer exposes a normalized intermediate model (`roomSides`, `roomWallContacts`, `sharedBoundaries`, `unsupportedOpenSides`).
- [x] Baseboard candidate derivation uses the normalized model as source-of-truth.
- [x] Case is handled: side with no direct wall is counted when touching another rectangle side that has wall support.
- [x] Regression tests cover neighbor wall inheritance and normalized model output.
- [x] A technical note documents model intent and limits for future refactors.

## Scope limits

- no openings exclusion slicing yet
- no room-type exclusion logic yet
- no pricing/estimate wiring

## Implementation notes

- Added `deriveRoomWallContactModel(plan)` in `app/src/editor/geometry/baseboards.js`.
- `deriveBaseboardCandidates(plan)` now consumes normalized model output.
- Neighbor wall inheritance was fixed to check both neighbor interior and shell support boundaries.
- Added tests in `app/tests/specs/baseboards.test.js`:
  - neighbor support via wall shell
  - normalized contact model output check
- Added technical note: `docs/room_wall_contact_model_v1.md`.

## Log (append-only)

- 2026-02-28 12:xx: Ticket created from architectural direction to decompose geometry into room-wall contacts.
- 2026-02-28 12:xx: Implemented normalized model export and migrated baseboard derivation to consume it.
- 2026-02-28 12:xx: Fixed missing-baseboard bug for side-touching neighbor wall shell case and added regression coverage.
