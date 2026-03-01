# Plan Model v0

Purpose: define the first persisted plan shape for the MVP editor before implementing more behavior.

Status:
- This is a working model for early editor slices and persistence.
- It is expected to evolve; changes should be versioned.

## Design goals

- Stable enough to persist locally for MVP.
- Explicit separation between:
  - authored plan data (persisted),
  - derived geometry (computed),
  - transient UI/editor state (not persisted).
- Capable of supporting known future features:
  - rooms + merged rooms
  - openings (doors/windows)
  - quantities/estimates

## Scope (v0)

Included now:
- background image placement
- scale calibration
- rectangles as authored primitives
- logical room entities (even if UI comes later)
- manual room merge semantics via shared `roomId` across touching rectangles
- openings entity placeholder shape (to avoid repainting the schema later)

Not included as persisted data:
- snap candidates
- magnetic-link live interaction state
- selection / hover / drag mode
- derived perimeters / quantities / estimate results

## Top-level structure

```json
{
  "version": 1,
  "planId": "plan_001",
  "meta": {
    "name": "Untitled plan",
    "createdAt": "2026-02-26T10:00:00Z",
    "updatedAt": "2026-02-26T10:00:00Z"
  },
  "background": {},
  "scale": {},
  "entities": {
    "rectangles": [],
    "openings": [],
    "rooms": [],
    "lighting": {
      "fixtures": [],
      "groups": [],
      "links": []
    }
  }
}
```

## Entities

### `background`

Used for tracing.

Suggested shape:
- `sourceType`: `"sample"` | `"dataUrl"` | `"url"` (MVP likely `"sample"` or `"dataUrl"`)
- `source`
- `opacity` (0..1)
- `transform`
  - `x`, `y`, `width`, `height`

Notes:
- Background transform is authored/editor-controlled and should be persisted.
- Viewport camera is *not* part of background; it belongs to transient editor state.

### `scale`

Converts world units to real-world units.

Suggested shape:
- `metersPerWorldUnit`: number | null
- `referenceLine`: optional
  - `x0`, `y0`, `x1`, `y1` (world coordinates)
  - `meters` (real-world entered value)

Notes:
- `metersPerWorldUnit` is the canonical conversion.
- `referenceLine` is UX/debug traceability, not strictly required for calculations.

### `entities.rectangles`

Primary authored geometry for v0 editor slices.

Suggested rectangle shape:
- `id`
- `kind`: `"roomRect"` | `"wallRect"`
- `x`, `y`, `w`, `h` (world units, axis-aligned)
- `wallCm`
  - `top`, `right`, `bottom`, `left` (for roomRect visual wall thickness support)
- `roomId`: string | null
- `label`: optional string

Notes:
- `kind` replaces the prototype `isWall` boolean with a clearer domain field.
- `wallCm` remains in v0 because the prototypes show it is useful, but calculations should not assume it is the final long-term model.
- `wallCm` is required to drive derived shell geometry (`outerRect`, wall bands, shared-boundary derivation); it is not passive metadata.
- `roomId` is on rectangles so multi-rectangle rooms can be modeled without duplicating geometry.

### `entities.rooms`

Logical rooms (for tags and later exclusions).

Suggested room shape:
- `id`
- `name`
- `roomType`: `"generic"` | `"bathroom"` | `"toilet"` | `"kitchen"` | `"hallway"` | `"bedroom"` | `"living_room"` | ...
- `rectangleIds`: string[]

Notes:
- A room may contain multiple rectangles (L-shapes etc.).
- `rectangleIds` is explicit so room membership can be validated.
- Merge v1 is author-driven: selecting touching rectangles and assigning one shared room id/name/type.
- Dissolve v1 removes the room entity and clears `roomId` from all member rectangles.

### `entities.openings`

Door/window placeholders for future tickets (not necessarily editable in first slices).

Suggested opening shape:
- `id`
- `kind`: `"door"` | `"window"`
- `host`
  - `rectangleId` (or future wall-run id)
  - `edge`: `"top"` | `"right"` | `"bottom"` | `"left"`
- `offset`
  - distance from edge start (world units)
- `length`
  - opening span (world units)
- `metadata`
  - optional type-specific fields (swing, sill, etc.) later

Notes:
- This shape is intentionally simple and may evolve when wall runs become explicit.
- The key v0 decision is to anchor openings to authored geometry + edge, not free-floating screen pixels.

### `entities.lighting`

Lighting inventory primitives for quantity and cost workflows.

Suggested shape:
- `fixtures`: array
  - switch/lamp fixtures with `id`, `kind`, `subtype`, `x`, `y`, `roomId`, `host`, `meta`
- `groups`: array
  - lamp arrays/groups with `id`, `name`, `roomId`, `fixtureIds[]`
- `links`: array
  - switch control links with `id`, `switchId`, `targetType`, `targetId`

Notes:
- v1 focus is quantity + mapping (`which switch controls which lamp/group`).
- Circuit simulation is deferred.
- `switch` hosts use `{ type: "wallSide", rectangleId, side, offset }`.
- `lamp` hosts use `{ type: "roomInterior", rectangleId?, offsetX?, offsetY? }`; if `rectangleId` exists the lamp is glued to that rectangle on moves.

## Invariants (v0)

- All IDs are unique within their entity type.
- Rectangles are axis-aligned and have `w > 0`, `h > 0`.
- `wallCm` side values are integers or finite non-negative numbers.
- `room.rectangleIds` references existing rectangles only.
- A rectangle references at most one `roomId`.
- If `rectangle.roomId != null`, the room exists and includes that rectangle ID.
- If `scale.metersPerWorldUnit != null`, it must be `> 0`.
- Openings reference an existing host rectangle and a valid edge.
- Opening `length > 0` and `offset >= 0`.
- Lighting links reference existing switches and valid targets (`lamp` or `lampGroup`).
- Lighting groups include existing lamp fixture IDs only.

## Persisted vs transient vs derived

### Persisted (Plan Model v0)
- `background`
- `scale`
- authored entities (`rectangles`, `rooms`, `openings`, `lighting`)
- metadata/version

### Transient editor state (not persisted in plan)
- camera (`x`, `y`, `zoom`)
- selection / hover
- active tool mode
- merge tool candidate selection (`mergeSelection.rectangleIds`)
- merge editing options (`mergeOptions.allowInternalSeamAdjust`)
- pointer drag/resize state
- temporary draw drafts
- live snap candidate previews

### Derived (computed)
- outer rectangles from `wallCm`
- shared wall-to-wall boundaries between touching pieces
- same-room seam intervals and locked side classification
- snap guides and candidate links
- room polygons / merged outlines (later)
- wall/perimeter segments
- quantities and estimate totals
- validation results

## Example Plan JSON (v0)

```json
{
  "version": 1,
  "planId": "plan_demo_001",
  "meta": {
    "name": "2BR draft",
    "createdAt": "2026-02-26T10:00:00Z",
    "updatedAt": "2026-02-26T10:12:00Z"
  },
  "background": {
    "sourceType": "sample",
    "source": "apartment1.png",
    "opacity": 0.35,
    "transform": { "x": 120, "y": 80, "width": 980, "height": 720 }
  },
  "scale": {
    "metersPerWorldUnit": 0.1,
    "referenceLine": {
      "x0": 140,
      "y0": 120,
      "x1": 340,
      "y1": 120,
      "meters": 20
    }
  },
  "entities": {
    "rectangles": [
      {
        "id": "rect_room_1",
        "kind": "roomRect",
        "x": 200,
        "y": 180,
        "w": 220,
        "h": 160,
        "wallCm": { "top": 10, "right": 10, "bottom": 10, "left": 10 },
        "roomId": "room_living",
        "label": "Living"
      },
      {
        "id": "rect_wall_1",
        "kind": "wallRect",
        "x": 420,
        "y": 180,
        "w": 18,
        "h": 160,
        "wallCm": { "top": 0, "right": 0, "bottom": 0, "left": 0 },
        "roomId": null
      }
    ],
    "openings": [
      {
        "id": "opening_1",
        "kind": "door",
        "host": { "rectangleId": "rect_wall_1", "edge": "left" },
        "offset": 22,
        "length": 30,
        "metadata": {}
      }
    ],
    "rooms": [
      {
        "id": "room_living",
        "name": "Living Room",
        "roomType": "living_room",
        "rectangleIds": ["rect_room_1"]
      }
    ],
    "lighting": {
      "fixtures": [],
      "groups": [],
      "links": []
    }
  }
}
```

## Migration strategy (early)

- Use top-level `version`.
- On load, pass persisted JSON through a `migratePlan(raw)` function.
- Keep migrations small and append-only by version.
- Do not persist transient editor state in the same object.

## Implications for upcoming tickets

- `T-0004`: build editor runtime around a `plan` object + transient `editorState`.
- `T-0005` / `T-0006`: operate on `entities.rectangles` only.
- `T-0003` (autosave): should persist the v0 plan after this schema exists.
- Snapping/magnetic links: model as transient/editor-layer mechanisms first; persist only if a future domain reason appears.
