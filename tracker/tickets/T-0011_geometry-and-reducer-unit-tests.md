# T-0011: Pure geometry + reducer unit tests (browser harness)

Created: 2026-02-26
Estimate: 2 points
Owner: simonas
Status history (append-only):
- 2026-02-26: OPEN
- 2026-02-26: IN_PROGRESS

## Goal
Add a lightweight, dependency-free unit test harness for high-risk pure editor logic (snapping, geometry math, reducer invariants).

## Acceptance criteria
- [x] A local test page can run pure JS tests in the browser (no build step, no npm install).
- [x] Tests cover contact-only snapping regression cases (no free-space alignment snap, edge/corner contact snap).
- [x] Tests cover reducer cleanup invariants for rectangle deletion (rooms/openings references).
- [x] Tests cover at least one camera/coordinate math invariant.
- [ ] Tests are manually run and results recorded (blocked here: no browser execution from sandbox).

## Notes / formulation
Node is currently broken on this machine (`icu4c` mismatch), so use a browser ESM harness now. Keep tests portable and dependency-free so they can later be migrated to a CLI runner if needed.

## Implementation notes
- Added browser-based test harness under `app/tests/`:
  - `index.html` + `index.js` runner entry
  - `test-runner.js` (minimal assertions + reporting)
  - specs for snapping, plan reducer, coordinate math, and scale helper math
- Focused on pure modules only (no canvas DOM interaction automation in this ticket).

## Log (append-only)
- 2026-02-26 14:10: Ticket created after user requested unit-test coverage before continuing feature work.
- 2026-02-26 14:10: Implemented browser ESM test harness and initial pure-module coverage; pending manual browser run.
- 2026-02-26 14:xx: Carried over to S003 as open work (status remains IN_PROGRESS pending manual run and results).
