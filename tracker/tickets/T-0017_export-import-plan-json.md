# T-0017: Export/import plan JSON (local file round-trip)

Created: 2026-02-26
Estimate: 3 points
Owner: simonas
Status history (append-only):
- 2026-02-26: OPEN
- 2026-02-26: IN_PROGRESS
- 2026-02-26: DONE

## Goal
Allow the user to export the current plan JSON and import a saved plan file, enabling manual backups and sharing before report/export UX exists.

## Acceptance criteria
- [x] User can export current `plan` JSON to a local file.
- [x] User can import a previously exported JSON file and replace the current plan.
- [x] Imported plan goes through the existing plan migration/normalization path.
- [x] Autosave and current editor interactions continue to work after import.
- [x] Invalid JSON / invalid plan shape failures are shown safely (no crash).

## Notes / formulation
This is a local-file round-trip feature only.

Scope limits:
- no cloud sync
- no merge/conflict resolution
- no multi-file project management

## Implementation notes
- Added toolbar controls in `app/src/ui-shell.js`:
  - `Export JSON`
  - `Import JSON` (+ hidden file input)
- Added `parseImportedPlanJsonText(...)` to `app/src/editor/persistence/local-plan-storage.js` so imports use the same `migratePlan(...)` normalization path as local autosave loads.
- Added export/import runtime flow in `app/src/editor/runtime.js`:
  - export current plan to downloaded JSON file (pretty-printed)
  - import selected JSON file, normalize/migrate, replace current plan, clear selection/interaction, reset tool to navigate
  - refresh `nextUserRectangleId` after import to avoid id collisions on future rectangle creation
  - safe error handling for malformed JSON / invalid plan shapes (file I/O status message, no crash)
- Added file I/O status summaries to debug/status/overlay text and `T-0017` manual smoke-check steps in `app/README.md`.

## Log (append-only)
- 2026-02-26 19:xx: Ticket created as S004 stretch backlog.
- 2026-02-26 20:xx: Started implementation. Added local JSON export/import round-trip through existing plan migration path; pending manual verification.
- 2026-02-26 20:xx: User manually verified JSON export/import round-trip and invalid-file safety handling. Ticket marked DONE.
