# T-0003: Autosave + reopen last plan

Created: 2026-02-25
Estimate: 3 points
Owner: simonas
Status history (append-only):
- 2026-02-25: OPEN
- 2026-02-26: DEFERRED (out of S001 pending Plan Model v0 stability)
- 2026-02-26: OPEN (moved into S002 committed backlog)
- 2026-02-26: IN_PROGRESS
- 2026-02-26: DONE

## Goal
Closing and reopening the app restores the last drawing state automatically.

## Acceptance criteria
- [x] App autosaves on edits (throttled/debounced).
- [x] App loads the last saved plan on startup.
- [x] If no saved plan exists, app starts with a sensible default (and/or sample background).
- [x] “Reset plan” exists (to recover from bad saved state).

## Notes / formulation
First storage target: local persisted JSON (likely localStorage for MVP).

Export/import to a JSON file can be a separate ticket.

Dependency note:
- This should happen after `T-0002` defines Plan Model v0, so we do not bake unstable structures into persistence.

## Implementation notes
- Added localStorage persistence adapter with:
  - load on startup (parse + basic migration/shape normalization for Plan Model v0)
  - debounced autosave on `plan/*` actions
  - flush on `pagehide` for better close/reload reliability
- Runtime now initializes from persisted plan when available, otherwise default+seed flow.
- Autosave/load status is surfaced in the runtime status line/overlay to support manual verification.
- `New Empty Plan` continues to work and now becomes the recovery path for a bad saved state (it autosaves the reset plan).
- Manual browser verification passed (user): edits autosave and reload restores latest plan state.

## Log (append-only)
- 2026-02-25 10:05: Ticket created.
- 2026-02-26 10:21: Deferred from S001. Will re-enter sprint planning after Plan Model v0 is defined and editor state shape is stable enough to persist.
- 2026-02-26 11:31: Re-entered sprint planning in S002 as a committed ticket after Plan Model v0 and core rectangle runtime slices stabilized.
- 2026-02-26 11:48: Implemented local autosave + load-on-startup wiring; awaiting manual smoke-check before DONE.
- 2026-02-26 12:02: User manual smoke-check passed (autosave + reopen + reset persistence). Marked DONE and committed.
