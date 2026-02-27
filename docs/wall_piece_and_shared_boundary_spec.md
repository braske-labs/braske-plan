# Wall Piece + Shared Boundary Spec (v1)

Status: draft for implementation guidance  
Date: 2026-02-27

## Why this exists

Current direction risk:
- `wallCm` as a passive property is not enough.
- If walls do not participate in geometry/snap/resize/perimeter logic, we get floating rectangles with decorative wall values.

Target behavior (from prototype intent + user requirement):
- A drawn piece is a **room interior plus walls**.
- Wall thickness enlarges the piece **outward per side**.
- When two pieces touch wall-to-wall, they behave as **connected geometry**, not unrelated rectangles.

## Core model

Each authored room piece has:
- `interiorRect`: `x, y, w, h` (world units)
- `wallCm`: `top, right, bottom, left` (authoring inputs)

Derived at runtime:
- `outerRect` from interior + `wallCm` converted to world units
- four wall bands (`top/right/bottom/left`) as explicit derived geometry slices

Interpretation:
- Interior is the usable room region.
- Walls are real geometry used for hit-testing, snapping, adjacency, and perimeter derivation.

## Behavior requirements

## 1) Wall editing semantics
- Changing `wallCm.<side>` expands/contracts the **outer shell** on that side.
- Interior rect remains anchored unless user action changes interior geometry.
- Visual result must clearly show wall band thickness changes.

## 2) Selection / interaction semantics
- Selecting a room piece selects the room+wall shell unit.
- Hit-testing and resize handles operate on the appropriate target for the active tool:
  - room editing mode: interior handles
  - shell/boundary editing mode (later): outer handles
- For MVP now, keep one mode, but outer geometry must still be available for snapping/derivation.

## 3) Shared-boundary sticking semantics
- If piece A wall shell edge contacts piece B wall shell edge with sufficient overlap, create a **shared-boundary constraint**.
- While dragging/resizing one side, the matching side of connected neighbor remains aligned (unless explicitly detached).
- This is contact-based adjacency, not free-form PowerPoint alignment.
- Detach operation must exist (equivalent to prototype “unlink snaps” for that boundary).

## 4) No-random-wall invariant
- `wallCm` must influence:
  - rendering,
  - snapping candidates,
  - adjacency/sticking,
  - derived perimeter segments.
- If any of those ignores wall shell geometry, feature is incomplete.

## Geometry invariants

- `interiorRect.w > 0`, `interiorRect.h > 0`
- `wallCm.side >= 0`
- `outerRect` always computed from interior + wall sides
- shared-boundary links are valid only when contact + overlap threshold still holds
- stale links are pruned on every geometry edit

## Derived geometry contract (for perimeter work)

The geometry engine should output a deterministic structure:
- `pieces[]` with interior + outer + wall band polygons/rect slices
- `boundarySegments[]` normalized axis-aligned segments
- `sharedBoundaries[]` segment pairs representing touching wall-to-wall edges

This output is the input for:
- perimeter/baseboard candidate computation,
- debug overlay highlighting counted segments,
- future door/window exclusion slicing.

## What this means for S005

## T-0018 (re-scoped)
Implement **authoring + meaningful geometry**, not just controls:
- per-side wall editing UI
- wall shell rendering derived from `wallCm`
- snapping/hit-test using wall shell where needed
- basic shared-boundary detect/prune primitives (or explicit dependency on next ticket)

## T-0019 (re-scoped)
Implement shared-boundary and perimeter foundation:
- contact-based shared boundary graph/link model
- link-preserving drag/resize propagation for connected boundaries
- deterministic boundary segment derivation from wall shells

## T-0020
Visualization + debug:
- show counted perimeter segments
- show shared boundaries and detached boundaries clearly

## Explicit non-goals for now

- full persistent magnetic system for arbitrary non-contact relationships
- complex constraint solving across long chains with conflict resolution
- curved/non-orthogonal geometry

## Acceptance test scenarios (must pass)

1. Increase left wall on selected room: outer shell expands left immediately.
2. Two rooms touching side-to-side: move one vertically; touching boundary stays aligned if linked.
3. Resize one touching side: neighbor boundary follows on linked side.
4. Detach boundary: subsequent edit no longer propagates.
5. Perimeter debug output reflects shell geometry, not interior-only rectangles.
