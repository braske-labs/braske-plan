# T-0033: Geometry freeze lock v1

Created: 2026-03-01
Estimate: 2 points
Owner: simonas
Status history (append-only):
- 2026-03-01: OPEN
- 2026-03-01: IN PROGRESS
- 2026-03-01: DONE

## Goal
Add a global lock so room geometry cannot be changed accidentally while doing non-geometry tasks (lighting, materials, quantities).

## Acceptance criteria
- [x] Toolbar has a visible global `Freeze Geometry` toggle.
- [x] When freeze is ON, rectangle draw/drag/resize/delete is blocked.
- [x] When freeze is ON, room merge/dissolve and room/wall kind toggles are blocked.
- [x] Lighting editing remains available while geometry is frozen.
- [x] Status/readout clearly shows freeze state.

## Notes / formulation
- Freeze is an edit lock, not a render mode.
- Freeze should be reversible with one click and should safely end any active geometry interaction.

## Implementation notes
- Added `editorState.editLocks.geometryFrozen`.
- Added `editor/locks/toggleGeometryFreeze`.
- Runtime blocks geometry interaction paths while frozen and auto-exits draw/merge interactions when lock is enabled.

## Log (append-only)
- 2026-03-01 20:xx: Implemented global lock toggle and geometry-guard rails in runtime.
