# Backlog

This is the working backlog derived from:
- `high_level_plan.md`
- `docs/roadmap.md`

Execution history and estimates live in:
- `tracker/` (append-only by convention)

## How we work (lightweight “sprints”)
- We plan **one sprint at a time** (1 week is a good default for solo).
- Each ticket should be **mergeable on its own**, ideally **≤ 1 day** of work.
- Each ticket has:
  - **Goal** (what user-visible thing changes)
  - **Acceptance criteria** (clear pass/fail)
  - **Estimate** (story points)

### Prototype policy
- Prototype files are **reference artifacts** for interaction ideas, not source code to port 1:1.
- We do **not** assume prototype data structures or feature ordering are correct.
- Before reimplementation of a complex prototype area, create a ticket for:
  - capability inventory (keep/change/later/drop)
  - domain/data model decisions
  - module boundaries and testability seams

### Reimplementation rule
- Rebuild functionality in **small slices** on the new architecture (e.g. camera first, then select/drag, then create/resize, then snapping).
- Prefer pure functions for geometry, units, snapping, and hit-testing so they can be tested independently of canvas/UI code.

### Story points (Fibonacci)
Use points for *complexity/risk*, not time:
- **1**: tiny, obvious, no risk
- **2**: small, some edge cases
- **3**: medium, multiple moving parts
- **5**: big/uncertain, needs iteration
- **8**: too big → split

## Epics

### Epic A — Editor core (trace fast, feel lag-free)
Goal: a drawing experience that makes it easy to trace a 2BR in <5 minutes.
- A1. Project skeleton + dev workflow
- A2. Canvas editor (pan/zoom/render loop)
- A3. Rectangle authoring (draw/select/drag/resize)
- A3b. Explicit wall-rectangle mode (outer-wall primitives)
- A4. Snapping (ephemeral/contact-only)
- A4b. Magnetic links + unlink (deferred until after first perimeter/baseboard outputs)
- A5. Background screenshot overlay + opacity controls
- A6. Scale setting (reference line → meters)
- A7. Geometry validation (“plan is complete” checks)
- A8. Performance instrumentation (FPS + update timings)

### Epic B — Plan model + persistence (close/reopen)
Goal: edits persist automatically and reopen restores the latest state.
- B1. Plan JSON schema + versioning
- B2. Autosave + load-on-startup
- B3. Export/import plan JSON

### Epic C — Rooms + tagging + merge (bathroom exclusions)
Goal: room typing drives calculation rules.
- C1. Assign rectangles to rooms
- C2. Merge multiple rectangles into one logical room
- C3. Room type tags (bathroom/toilet/etc.)

### Epic D — Openings (doors/windows)
Goal: doors/windows can be placed and resized and influence quantities.
- D1. Data model for openings attached to walls
- D2. Editing UI (create/drag/resize)
- D3. Correct snapping behavior + constraints

### Epic E — Baseboards + estimates
Goal: compute baseboards and show an explainable estimate.
- E1. Derive wall/perimeter segments from authored shapes
- E1b. Normalize room-wall contact model (intermediate geometry layer)
- E2. Baseboard quantity with exclusions (room types + openings)
- E3. “Highlight counted segments” overlay (debug)
- E4. Local JSON price catalog + cost totals

## Priority note (2026-02-26)
- Prioritize wall-thickness authoring + derived perimeter geometry before persistent magnetic-link behavior.
- Rationale: perimeter/baseboard feedback delivers value sooner, while sticky links can be deferred without blocking geometry derivation.
- Wall behavior spec reference: `docs/wall_piece_and_shared_boundary_spec.md` (room+wall shells, shared-boundary contact semantics, no passive `wallCm`).
