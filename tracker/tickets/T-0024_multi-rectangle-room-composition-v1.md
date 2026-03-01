# T-0024: Multi-rectangle room composition v1

Created: 2026-02-28
Estimate: 3 points
Owner: simonas
Status history (append-only):
- 2026-02-28: OPEN
- 2026-02-28: IN_PROGRESS
- 2026-02-28: DONE

## Goal
Allow multiple rectangles to be composed into one logical room so L-shapes and split room interiors can be represented without hacks.

## Acceptance criteria
- [x] User can select multiple room rectangles and assign all to one room in one action.
- [x] Existing room tags (name/type) remain stable when adding/removing rectangles from that room.
- [x] Room membership persists in `entities.rooms[*].rectangleIds` and rectangle `roomId`.
- [x] Converting any member rectangle to `wallRect` removes it from room membership safely.
- [x] Merge flow is explicit (`Merge Room` tool -> select touching room rects -> `Complete Merge`).
- [x] Dissolve flow exists (`Dissolve Room` clears all members of the selected room).
- [x] Full shared same-room seams lock resize handles and convert body drag attempts to pan.

## Notes / formulation
- Keep v1 simple: composition only, no advanced merge/split UI choreography.
- Must preserve current single-rectangle flow as a subset.

## Implementation notes
- Added pure merge topology helper module `app/src/editor/geometry/room-merge.js`:
  - touching adjacency derivation
  - connected selection checks
  - room seam interval derivation
  - full-seam locked-side classification
- Added reducer actions in `app/src/editor/state/plan.js`:
  - `plan/rooms/mergeRectangles`
  - `plan/rooms/dissolveRoom`
- Added merge UI/editor state in `app/src/editor/state/editor-ui.js`:
  - tool `mergeRoom`
  - transient `mergeSelection.rectangleIds`
  - actions `editor/merge/toggleRectangle`, `editor/merge/clear`
- Added toolbar and room-panel controls in `app/src/ui-shell.js`:
  - `Merge Room`
  - `Complete Merge`
  - `Cancel Merge`
  - `Dissolve Room`
  - `Internal Slides: On/Off` toggle
- Wired runtime behavior in `app/src/editor/runtime.js`:
  - merge-tool click-to-toggle selection on `roomRect`
  - merge completion gating (>=2, connected, non-empty room name)
  - merge completion/dissolve/cancel actions
  - merged-room group drag (move all room members together)
  - connectivity guard so room members cannot be disconnected by drag/resize without dissolve
  - internal seam slide mode (when toggle is ON, cardinal locked handles slide paired seam by resizing both touching members)
  - default seam lock enforcement when toggle is OFF (locked handles remain blocked/grey)
  - room navigator sidebar: clickable room list, double-click center-on-room, and per-room area/baseboard details
  - room-scoped color palette so merged members share one color and active room is emphasized
- Added tests:
  - `app/tests/specs/room-merge.test.js`
  - extended `app/tests/specs/plan-reducer.test.js`

## Log (append-only)
- 2026-02-28 13:xx: Ticket created for S006 committed backlog.
- 2026-02-28 14:xx: Implemented merge tool flow, reducer merge/dissolve actions, seam-lock behavior, and unit tests.
- 2026-02-28 15:xx: Refined merge editing behavior: room-group drag, anti-disconnect topology guard, and optional internal seam slide toggle (default OFF).
- 2026-02-28 16:xx: Sidebar room navigator now includes unassigned roomRect fallbacks (rectangle-id entries) so every roomRect is visible/selectable.
- 2026-03-01 10:xx: Merge no longer requires room name input; empty-name merge uses fallback `Merged Room`.
