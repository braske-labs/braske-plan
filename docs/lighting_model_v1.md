# Lighting Model v1 (Switches, Lamps, Links, Quantities)

## Scope
This v1 is quantity-first:
- place switches and lamps
- link switches to one or many lamps (or lamp groups)
- compute room-level and plan-level counts for pricing

No electrical simulation in v1 (no circuit load balancing, no phase model).

## Plan schema additions

Add under `entities`:

```json
{
  "lighting": {
    "fixtures": [],
    "groups": [],
    "links": []
  }
}
```

### `fixtures`

Point-like authoring entities.

```json
{
  "id": "fx_001",
  "kind": "switch",
  "subtype": "switch_single",
  "x": 412.5,
  "y": 220.0,
  "roomId": "room_living_1",
  "host": {
    "type": "wallSide",
    "rectangleId": "rect_12",
    "side": "right",
    "offset": 0.42
  },
  "meta": {
    "label": "S1"
  }
}
```

```json
{
  "id": "fx_101",
  "kind": "lamp",
  "subtype": "led_spot",
  "x": 520.0,
  "y": 300.0,
  "roomId": "room_living_1",
  "host": {
    "type": "roomInterior"
  },
  "meta": {
    "label": "L1"
  }
}
```

Rules:
- `switch` fixtures must be wall-hosted (`host.type = wallSide`) and slide only along that host side.
- `lamp` fixtures are room-interior by default.
- Fixtures are glued to authored geometry:
  - switches stay on their host wall side when host rectangles move,
  - lamps with `host.rectangleId` translate with that rectangle.

### `groups`

Use groups for 3/6/9 arrays of lamps.

```json
{
  "id": "lg_01",
  "kind": "lampGroup",
  "name": "Kitchen spots",
  "roomId": "room_kitchen_1",
  "fixtureIds": ["fx_101", "fx_102", "fx_103", "fx_104", "fx_105", "fx_106"],
  "meta": {
    "pattern": "manual"
  }
}
```

### `links`

Switch control mapping:

```json
{
  "id": "lk_01",
  "switchId": "fx_001",
  "targetType": "lampGroup",
  "targetId": "lg_01"
}
```

Also allow direct link to single lamp:

```json
{
  "id": "lk_02",
  "switchId": "fx_001",
  "targetType": "lamp",
  "targetId": "fx_101"
}
```

## Derived quantities for pricing

From `lighting` derive:
- count by fixture subtype (`switch_single`, `switch_double`, `led_spot`, ...)
- lamp totals by room
- switch totals by room
- link count (useful for QA and electrician scope sanity)
- group count and average lamps/group

Suggested derived payload:

```json
{
  "derived": {
    "lighting": {
      "fixtureCountsBySubtype": {
        "switch_single": 4,
        "led_spot": 18
      },
      "roomTotals": [
        {
          "roomId": "room_living_1",
          "switchCount": 2,
          "lampCount": 9,
          "groupCount": 1
        }
      ],
      "linkCount": 6
    }
  }
}
```

## Interaction slices (implementation order)

### Slice A — Data model + sidebar totals
- add `entities.lighting` to plan model/persistence
- show plan totals in sidebar (switches, lamps, groups, links)

### Slice B — Placement/editing
- tools: `Place Switch`, `Place Lamp`
- switch host constraint on wall side
- move/delete fixture

### Slice C — Grouping + linking
- create lamp group from selected lamps
- assign/unassign switch links to lamp(s)/group(s)
- draw lightweight link overlay lines in debug mode

### Slice D — Validation + export
- validate dangling host/room/link references
- include `derived.lighting` snapshot in export for bug repro

Current v1 implementation notes:
- UI includes `Group Active Room Lamps`, `Toggle Link Source → Group`, and `Delete Group`.
- Export JSON includes `derived.lighting` summary snapshot.

## Validation rules (v1)
- every `link.switchId` must reference an existing switch fixture
- every link target must exist and match target type
- every group fixture must exist and be `kind=lamp`
- switch with `wallSide` host must still lie on host side after geometry edits (warn if drift)
