# Roadmap (Companion)

This is a practical sequence for shipping the core loop fast: trace → quantities → instant updates → save/reopen.

## Milestone 0: Keep the prototypes as reference
- Preserve the “stage0” HTML files for interaction ideas and regression checks.

## Milestone 1: MVP app skeleton (no estimates yet)
Definition of done:
- Editor loads with background overlay.
- Draw/drag/resize/snapping works.
- Basic geometry validity checks exist (even if strict and simple).
- Autosave + reopen restores the last plan.

## Milestone 2: Scale + dimension correctness
Definition of done:
- User can set scale from a reference line + meters input.
- Dimensions display in meters/cm and match expected values.

## Milestone 3: Rooms + tagging
Definition of done:
- Each rectangle belongs to a room.
- User can merge multiple rectangles into one logical room (L-shapes).
- Room has a type tag (bathroom/toilet/etc).

## Milestone 4: Openings (doors/windows)
Definition of done:
- Door/window representation that:
  - Snaps to walls,
  - Is resizable,
  - Can be used as an “exclusion segment” in later quantity calculations.

## Milestone 5: Baseboards (first real estimate)
Definition of done:
- Baseboard length computed from geometry with exclusions:
  - Exclude doors/windows.
  - Exclude bathrooms/toilets (room type rule).
- Baseboard length shown with a breakdown and a “highlight on plan” overlay.
- Updates in <200ms for typical edits.

## Milestone 6: Price catalog + estimate UX
Definition of done:
- Local JSON price catalog used to compute a cost estimate from quantities.
- UI shows quantities + unit prices + totals (transparent math).

## Milestone 7: Paint estimate inputs
Definition of done:
- Plan has wall-height input.
- Paintable wall area is computed from perimeter segments with exclusions.
- Room-level and plan-level paint area totals are visible.

## Milestone 8: Lighting inventory (quantity-only v1)
Definition of done:
- Switches/lamps can be placed and assigned to rooms.
- Room-level + total fixture counts are visible and persisted.

## Milestone 9: Export/report (optional)
Definition of done:
- Export plan JSON.
- Export a simple report view (print/PDF later).
