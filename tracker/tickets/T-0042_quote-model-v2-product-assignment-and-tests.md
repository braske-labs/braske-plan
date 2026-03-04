# T-0042: Quote model v2 — product assignment and reducer test updates

Created: 2026-03-02
Estimate: 1 point
Owner: simonas
Status history (append-only):
- 2026-03-02: OPEN
- 2026-03-02: IN PROGRESS
- 2026-03-02: DONE

## Goal
Finalize quote v2 by wiring fixture/opening product assignments into quote math and aligning reducer tests with new model fields.

## Acceptance criteria
- [x] Selected fixture can be assigned product id and reflected in estimate math.
- [x] Selected door opening can be assigned product id and reflected in estimate math.
- [x] Doors use priced catalog rows; windows stay zero-cost rows.
- [x] Reducer tests cover new quote/view defaults and key quote actions.
- [x] Existing reducer expectations updated for new `productId` defaults.

## Notes / formulation
- This ticket avoids geometry changes and focuses on pricing-data correctness + regression coverage.

## Implementation notes
- Runtime control synchronization for fixture/opening product selectors in `app/src/editor/runtime.js`.
- Test updates in `app/tests/specs/plan-reducer.test.js`:
  - opening add expectation now includes door `productId`,
  - new quote/view action tests added.

## Log (append-only)
- 2026-03-02 19:xx: Ticket created from T-0038 split.
- 2026-03-02 20:xx: Product assignment flow and reducer tests updated.
