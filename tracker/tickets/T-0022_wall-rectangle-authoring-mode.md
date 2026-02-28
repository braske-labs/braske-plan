# T-0022: Wall-rectangle authoring mode (outer-wall support)

Created: 2026-02-27
Estimate: 3 points
Owner: simonas
Status history (append-only):
- 2026-02-27: OPEN
- 2026-02-27: IN_PROGRESS
- 2026-02-27: DONE (implementation complete; manual smoke verification pending)

## Goal
Allow authored rectangles to be explicitly marked as whole-wall primitives (`kind = wallRect`) so outer-wall workflows are first-class, not accidental.

## Acceptance criteria
- [x] User can switch selected rectangle between `roomRect` and `wallRect`.
- [x] `wallRect` visualization is distinct from room interior rectangles.
- [x] Baseboard candidate logic can use touching `wallRect` support for room-side counting.
- [x] Existing draw/select/drag/resize/snapping interactions remain stable.
- [x] Plan JSON import/export and autosave preserve the chosen `kind`.

## Notes / formulation
This ticket is about authoring semantics and UX controls, not final wall network solving.

Scope limits:
- no automatic conversion of existing layouts
- no openings-on-wall UI yet
- no pricing/exclusion logic in this ticket

## Implementation notes
- Added `plan/rectangles/setKind` reducer action in `app/src/editor/state/plan.js`.
- Wall-mode conversion clears `wallCm` to avoid shell-expansion artifacts on `wallRect` primitives.
- Added toolbar toggle button (`Set As Wall` / `Set As Room`) in `app/src/ui-shell.js`.
- Wired runtime handlers in `app/src/editor/runtime.js`:
  - toggles selected rectangle kind
  - updates button state (`aria-pressed`, label, disabled)
  - disables wall-thickness editing controls for `wallRect`
  - shows selected kind in overlay/status.
- Added reducer tests in `app/tests/specs/plan-reducer.test.js`.
- Added manual smoke steps in `app/README.md`.

## Log (append-only)
- 2026-02-27 12:xx: Ticket created from user feedback requesting explicit whole-wall rectangle workflow for outer walls.
- 2026-02-27 13:xx: Implemented selected-rectangle kind toggle and wall-editing guardrails (`roomRect` vs `wallRect`).
