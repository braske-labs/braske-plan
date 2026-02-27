# Drawing Model Notes (Companion)

This doc captures the current “shape authoring” direction suggested by the prototypes and the human vision doc. It can change freely.

## Authoring primitives (current direction)
- Rectangles are the primary authoring object because they are fast to draw and easy to snap.
- A rectangle can represent:
  - a **room region** (interior filled area), or
  - a **wall segment** (long/narrow rectangles), toggled via an “is wall” switch.
- Rectangles can have per-side wall thickness values (useful for “outer rect” vs “inner rect”).
- Required semantics update: wall thickness is not decorative metadata; it must participate in shell geometry, contact behavior, and perimeter derivation.
- Detailed spec: `docs/wall_piece_and_shared_boundary_spec.md`.

## Snapping / magnetic behavior
Goal: make users draw *clean* geometry so we can avoid fancy early algorithms.
- Basic snap candidate (within a pixel threshold) aligns edges.
- “Magnetic links” can persist alignment so resizing one element moves/adjusts the neighbor edge.
- Provide an “unlink snaps” escape hatch for when the user wants to break constraints.
- Current priority decision: keep contact-only snapping and defer persistent magnetic links/unlink until after first perimeter/baseboard outputs are working.

## Rooms, tags, and merges
- Each rectangle belongs to a logical room.
- A logical room can contain multiple rectangles (for L-shapes / alcoves).
- Room type tags (bathroom/toilet/etc.) drive exclusions for calculations like baseboards.

## Scale + units
- User draws a reference line and enters its real-world length in meters.
- The editor stores `metersPerWorldUnit` so all derived computations are in meters/cm.

## Doors and windows (planned)
Doors/windows are part of the MVP because baseboard quantities must exclude them.

Working hypothesis:
- Openings are modeled as segments “cut out” from wall runs.
- A door/window should be attached to a wall and slide/resize along it.
- Internally, this likely becomes: wall run = wall segment(s) + opening segment(s) + wall segment(s).

## Baseboards (first estimate)
Intent (initial rules; refine with real examples):
- Baseboards run along relevant interior wall segments.
- Exclusions:
  - No baseboards in bathrooms/toilets (by room tag).
  - Exclude door/window spans.
  - Decide whether to exclude kitchen cabinets/built-ins later (explicit rule).
- The UI should show both:
  - total length (meters), and
  - a debug overlay highlighting exactly which segments are counted.
