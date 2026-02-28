# Room-Wall Contact Model v1

Status: implemented for baseboard derivation  
Date: 2026-02-28

## Purpose

Normalize authored rectangles into a geometry model where baseboard logic is evaluated as contact between:
- room interior sides
- supported wall boundaries

This avoids ad-hoc rectangle pair rules and makes diagnostics explainable.

## Input

- `roomRect` authoring rectangles (`x/y/w/h`, `wallCm`, optional `roomId`)
- `wallRect` primitives
- scale (`metersPerWorldUnit`)

## Derived model

`deriveRoomWallContactModel(plan)` returns:
- `roomSides[]`: normalized per-side records for each room rectangle
  - side geometry (`axis`, interval, interior coordinate)
  - wall support metadata (`hasWallCmSupport`, `hasWallRectSupport`, `hasNeighborSupport`)
  - support intervals on that side
- `roomWallContacts[]`: normalized contact segments (`room side` touching `supported wall`)
- `sharedBoundaries[]`: touching opposite-side overlaps between room sides
- `unsupportedOpenSides[]`: uncovered side intervals (enclosure diagnostics)

## Support propagation rule

If a room side has no direct wall support, it inherits support intervals when:
- it touches an opposite side of another room that is supported, and
- overlap is non-zero under tolerance.

Neighbor support contact checks both:
- neighbor interior boundary (e.g. support from touching `wallRect`)
- neighbor shell boundary (e.g. support from `wallCm` expansion)

This handles the case: “room side has no wall but touches another rectangle’s wall.”

## Baseboard rule (v1)

Count baseboard candidates from `roomWallContacts[]`, then prune same-room internal seams using shared-boundary overlaps.

## Known limits

- openings/door-window exclusions are not applied yet
- room-type exclusions are not applied yet
- tolerance settings still affect borderline contacts
