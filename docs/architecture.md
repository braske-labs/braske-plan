# Architecture (Companion)

This document captures only the “hard choices” and system shape needed to build the MVP quickly and safely. It should stay small.

## Goals
- Local-first, offline by default.
- Instant feedback loop: edits → recalculated quantities/estimates in <200ms.
- Deterministic geometry + calculations (no ML in the critical path).

## Non-goals (MVP)
- Vendor-integrated pricing / live quotes.
- Automatic vectorization of screenshots.
- Curved / non-orthogonal walls.

## Current prototypes (reference)
The drawing interaction experiments live under:
- `design/stage0_initial_sketches/`

Notable capabilities already explored there:
- Pan/zoom, draw/drag/resize rectangles.
- Background screenshot overlay.
- Snapping + “magnetic links” that keep edges aligned.
- Scale-setting with a reference line.
- Per-side “wall thickness” and a “this is a wall” toggle.

Prototype inventory and keep/change/later/drop decisions:
- `docs/prototype_capability_inventory.md`

## Proposed system components (MVP)
- **Canvas UI (editor):** rendering + pointer interactions + selection + snapping.
- **Plan model (state):** the authoritative JSON structure of the plan.
- **Geometry engine:** validates constraints + derives wall/perimeter segments from shapes.
- **Estimator:** turns geometry outputs into quantities + cost estimates.
- **Persistence:** autosave + reopen (single plan initially; multiple plans later).

Plan schema reference:
- `docs/plan_model_v0.md`

## Editor module boundaries (reimplementation target)

These are logical modules; exact file names can evolve.

- **App bootstrap**
  - Mount page, wire dev shell, initialize editor.
- **Editor runtime**
  - Owns canvas lifecycle, render scheduling, and integration of subsystems.
- **Editor controller / input state machine**
  - Pointer/keyboard interactions and tool-mode transitions.
  - Produces domain actions or editor-state updates.
- **Renderer**
  - Draws background, grid, entities, overlays, selection, debug visuals.
- **Plan store (domain state)**
  - Holds persisted `plan` object (Plan Model v0).
  - Applies pure updates to plan entities.
- **Editor UI state store (transient)**
  - Camera, selection, draft operations, active tool, hover, transient snap previews.
- **Geometry / math modules (pure)**
  - Coordinates, units, hit testing, resize math, validation, snapping, later wall/perimeter derivation.
- **Persistence adapter**
  - Serialize/deserialize + migrations + autosave/load.
- **Estimator engine (later)**
  - Derived quantities and cost totals from plan + rules + price catalog.

## State flow (high level)

1. Browser event enters editor controller (`pointerdown`, `pointermove`, toolbar action).
2. Controller reads current:
   - transient editor state
   - persisted plan state
3. Controller calls pure helpers (hit-test, transforms, snap candidate, resize math).
4. Controller emits:
   - plan updates (persisted domain changes), and/or
   - editor-state updates (selection, draft, camera, preview guides)
5. Store applies updates.
6. Renderer draws from:
   - `plan` (authored data)
   - `editorState` (transient overlays/selection)
   - derived values computed via pure selectors/helpers
7. Persistence adapter listens to plan changes (later ticket) and autosaves the persisted `plan`.

## State separation (critical)

- **Persisted plan state** must stay free of:
  - camera
  - pointer modes
  - draft rectangles
  - live snap previews
  - temporary UI flags
- **Transient editor state** must stay free of:
  - business/estimate outputs we can derive deterministically

This avoids coupling the persistence format to UI implementation details.

## Plan JSON (v0)
Keep the stored model minimal; computed values should be derived.

Reference:
- `docs/plan_model_v0.md`

## Invariants / constraints (MVP)
- Orthogonal (90°) geometry only.
- “Complete plan” means it passes a small set of checks (to be defined in the vision doc).
- Room typing must work even when a room consists of multiple rectangles (merged logical room).
- Wall thickness must be geometry-active (render/snap/adjacency/derivation), not passive display metadata.

Wall behavior reference:
- `docs/wall_piece_and_shared_boundary_spec.md`

## Performance notes
- Separate “authoring primitives” from “derived geometry”.
- Recompute derived geometry incrementally on each edit.
- If needed, add a simple spatial index for snapping and perimeter/segment building.
- Keep the render loop and plan-update logic decoupled so we can time recalculation cost separately from draw cost.

## Testability strategy

### Pure modules (unit-test first)
- Coordinate transforms (`screenToWorld`, `worldToScreen`)
- Units conversion (`cmToWorld`, `worldToCm`, formatting helpers)
- Hit-testing
- Resize math
- Snap candidate generation / scoring
- Magnetic-link application rules
- Plan validation helpers

Why:
- These contain the real correctness risk and are deterministic.
- They should not require canvas or DOM to test.

### UI / editor integration (manual checks first, automate later)
- Canvas initializes and resizes correctly.
- Tool mode transitions behave correctly.
- Pointer interactions do not conflict (drag vs pan vs resize).
- Overlays reflect state (selection, dimensions, guides).

Initial approach:
- Manual smoke checks per ticket with explicit steps.

Later:
- Add lightweight browser-driven integration checks for key flows.

### Prototype regression checks (behavioral, not structural)
- Compare interaction feel against `main11` for target behaviors:
  - pan/zoom feel
  - basic rectangle editing
  - snapping tolerance
  - scale-setting flow

Do not require code-level parity with the prototype.

## Persistence strategy (MVP)
Start simple:
- Autosave to local storage (or a single JSON file if served locally with file access).
- On load, restore the most recent plan automatically.

Later:
- Explicit project files (open/save-as) and versioning.
