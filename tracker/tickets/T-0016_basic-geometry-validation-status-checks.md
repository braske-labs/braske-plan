# T-0016: Basic geometry validation status checks

Created: 2026-02-26
Estimate: 3 points
Owner: simonas
Status history (append-only):
- 2026-02-26: OPEN
- 2026-02-26: IN_PROGRESS
- 2026-02-26: DONE

## Goal
Surface simple geometry issues early (via status/debug UI) so the user can tell whether a plan is “good enough” before quantity/estimate work.

## Acceptance criteria
- [x] App computes a small set of basic validation checks for the current plan.
- [x] Validation status is visible in the UI (debug/status panel is acceptable).
- [x] At least one warning scenario is detectable (for example overlapping rectangles or missing scale).
- [x] Validation logic is implemented in pure helpers with test coverage where practical.
- [x] Existing edit interactions remain responsive.

## Notes / formulation
This is a lightweight validation slice, not a full geometry engine.

Scope limits:
- no automatic repair
- no hard blocking of edits
- no exhaustive CAD correctness checks

## Implementation notes
- Added pure validation helper `validateBasicPlanGeometry(...)` in `app/src/editor/geometry/validation.js`:
  - missing scale warning
  - invalid rectangle geometry warning
  - overlapping rectangle-pair warning (edge touching is not overlap)
  - duplicate rectangle id warning
- Added browser unit tests in `app/tests/specs/validation.test.js` and registered them in `app/tests/index.js`.
- Wired memoized validation summary into `app/src/editor/runtime.js`:
  - debug overlay summary + first warning line
  - status line validation summary
  - HTML overlay validation detail text
- Updated `app/src/ui-shell.js` and `app/README.md` for T-0016 copy + manual smoke checklist.

## Log (append-only)
- 2026-02-26 19:xx: Ticket created for S004 committed backlog.
- 2026-02-26 20:xx: Started implementation. Added pure validation helper/tests and UI validation summaries (debug/status/overlay). Pending manual browser verification.
- 2026-02-26 20:xx: User manually verified missing-scale and overlap warnings plus normal editor responsiveness. Ticket marked DONE.
