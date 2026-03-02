# Derived Baseboard Snapshot (`derived.baseboards`)

`derived.baseboards` is an export-only debug snapshot. Runtime truth always comes from canonical plan geometry (`entities.rectangles`, `entities.rooms`, `entities.openings`) and is recomputed on load.

## Shape

```json
{
  "algoVersion": "baseboard-v1-room-wall-contact",
  "computedAt": "2026-03-02T12:00:00.000Z",
  "excludedRoomTypes": ["bathroom", "toilet"],
  "counts": {
    "candidateSegmentCount": 0,
    "rawSegmentCount": 0,
    "countedSegmentCount": 0,
    "excludedSegmentCount": 0,
    "prunedSegmentCount": 0,
    "sharedBoundaryCount": 0,
    "unsupportedOpenSideCount": 0
  },
  "lengths": {
    "candidate": { "world": null, "meters": null },
    "raw": { "world": null, "meters": null },
    "counted": { "world": null, "meters": null },
    "excluded": { "world": null, "meters": null },
    "pruned": { "world": null, "meters": null }
  },
  "segments": {
    "candidates": [],
    "raw": [],
    "counted": [],
    "excluded": [],
    "unsupportedOpenSides": []
  },
  "sharedBoundaries": []
}
```

## Notes

- `raw` = derived before room-type exclusions.
- `counted` = after exclusions (used for quantity totals).
- `excluded` = removed by room-type exclusion rules.
- Snapshot is intended for repro/diff and may evolve with `algoVersion`.
