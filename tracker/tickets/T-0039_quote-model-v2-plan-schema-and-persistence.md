# T-0039: Quote model v2 — plan schema and persistence

Created: 2026-03-02
Estimate: 3 points
Owner: simonas
Status history (append-only):
- 2026-03-02: OPEN
- 2026-03-02: IN PROGRESS
- 2026-03-02: DONE

## Goal
Add persisted quote/view state to plan model and ensure import/export/autosave round-trips keep the new structure stable.

## Acceptance criteria
- [x] `createEmptyPlan()` includes default `quote` and `view` sections.
- [x] Reducer actions exist for quote group mode, catalog upsert, defaults, and per-room quote config.
- [x] Openings/lighting entities can carry `productId` where relevant.
- [x] Local plan migration normalizes `quote`, `view`, and new product fields.
- [x] Existing plans load with safe defaults when quote/view fields are missing.

## Notes / formulation
- This ticket is model + persistence only; no estimate UI behavior changes here.

## Implementation notes
- Updated `app/src/editor/state/plan.js` with quote/view defaults and reducer actions:
  - `plan/view/toggleRoomHighlighting`
  - `plan/view/toggleWallsBlack`
  - `plan/quote/*`
  - `plan/openings/setProduct`
  - `plan/lighting/setFixtureProduct`
- Added quote/view normalization + product field migration in `app/src/editor/persistence/local-plan-storage.js`.

## Log (append-only)
- 2026-03-02 19:xx: Ticket created from T-0038 split.
- 2026-03-02 20:xx: Model + migration implementation completed.
