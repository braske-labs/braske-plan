# T-0012: Fix side-touch drag `top-top` snapping regression

Created: 2026-02-26
Estimate: 2 points
Owner: simonas
Status history (append-only):
- 2026-02-26: OPEN
- 2026-02-26: IN_PROGRESS
- 2026-02-26: DONE

## Goal
Fix the snapping regression where dragging a rectangle that is already side-touching another rectangle may fail to snap `top-top` alignment.

## Acceptance criteria
- [x] While two rectangles are side-touching (left/right contact), dragging one up/down can snap `top-top` alignment.
- [x] Existing corner-touch drag alignments (for example `bottom-top`) still work.
- [x] No free-space PowerPoint-style alignment snapping is reintroduced.
- [x] Regression is covered by the `T-0011` snapping tests.

## Notes / formulation
This is a follow-up bug fix to `T-0008`. The intended behavior is contact-only snapping, including same-edge alignment while already touching on the other axis.

Keep scope narrow:
- no new snapping modes
- no guide-line visuals
- no magnetic links/persistent constraints

### Root cause hypothesis (current implementation)
The drag snap path currently computes per-axis candidates and then selects a single winner (except for the explicit corner dual-snap path). In the side-touch + vertical-slide case, an already-satisfied snap/contact on one axis can be treated as the "best" candidate and block applying a new compatible `top-top` / `bottom-bottom` snap on the moving axis.

This means the bug is likely in snap candidate selection / composition (drag path), not in rectangle geometry math or tolerance conversion.

### Fix outline (narrow ticket scope)
Implement a drag snap resolution step that preserves already-valid contact constraints while evaluating same-edge vertical alignments:
- Treat already-satisfied side contact as a maintained constraint, not a competing snap that overrides selection.
- When dragging vertically in a side-touch state, prefer applying compatible `y` alignment snaps (`top-top`, `bottom-bottom`) without breaking the existing contact-only rule.
- Keep the existing no-free-space rule: alignment snaps must still be valid only when contact/overlap requirements are met.
- Preserve existing corner snap behavior.

Practical implementation options (either is acceptable for T-0012):
- Add a targeted drag-path fix for the side-touch vertical sliding case (minimal change).
- Or refactor drag snap selection to preserve compatible constraints (preferred if small and well-tested), while keeping ticket scope limited to the observed regression.

If the implementation grows beyond a narrow patch, move/continue under `T-0013` (multi-constraint snap resolution) and link back here.

## Implementation notes
Suggested code investigation points (current codebase):
- `app/src/editor/geometry/snapping.js`
  - `snapDraggedRectangle(...)`
  - drag axis candidate generation/filtering (`xCandidate`, `yCandidate`)
  - single-axis selection after `chooseBestDragCornerSnap(...)`
- `app/src/editor/runtime.js`
  - drag path calling `snapDraggedRectangle(...)` during `draggingRect` pointer moves

Test cases to add under `T-0011`:
- Side-touch left/right contact maintained while dragging vertically -> `top-top` snaps.
- Same setup -> `bottom-bottom` snaps.
- Corner snap still wins when both axes are newly satisfied.
- No alignment snap when side contact is not present (free-space case).

Current implementation progress:
- Patched drag single-axis snap selection in `app/src/editor/geometry/snapping.js` so a zero-delta maintained-contact candidate does not override a nonzero alignment candidate on the other axis.
- Added regression tests for side-touch drag `top-top` and `bottom-bottom` alignment cases in `app/tests/specs/snapping.test.js`.
- Corner dual-snap path was not changed.
- Final fix composes compatible drag `x+y` snap pairs from raw axis candidates before single-axis fallback, allowing side-contact correction and `top-top`/`bottom-bottom` alignment in the same drag step.

## Log (append-only)
- 2026-02-26 14:xx: Ticket created after user reported `top-top` drag alignment failing in a side-touch sliding case.
- 2026-02-26 14:xx: Added to S003 as open carry-over bug ticket (deferred from S002 closeout).
- 2026-02-26 17:45: Added root-cause and fix-outline notes clarifying this is a snap selection/composition issue and referencing `T-0013` if generalized solver work is needed.
- 2026-02-26 18:xx: Started implementation with a targeted drag-path snap selection patch + regression tests; pending manual browser verification of the reported case.
- 2026-02-26 18:xx: Initial targeted single-axis fix was insufficient; added raw dual-axis drag candidate composition and strengthened regression coverage.
- 2026-02-26 18:xx: User manually verified drag snapping now works for the reported case. Marked DONE.
