import { deriveBaseboardCandidates } from "../../src/editor/geometry/baseboards.js";
import { BASEBOARD_ALGO_VERSION, deriveBaseboardExportSnapshot } from "../../src/editor/geometry/baseboard-snapshot.js";
import { assertClose, assertDeepEqual, assertEqual, test } from "../test-runner.js";

function createPlan(rectangles, rooms = [], metersPerWorldUnit = 0.01) {
  return {
    scale: {
      metersPerWorldUnit,
      referenceLine: null
    },
    entities: {
      rectangles,
      rooms
    }
  };
}

test("baseboard export snapshot includes deterministic metadata and totals", () => {
  const plan = createPlan(
    [
      {
        id: "rect_a",
        kind: "roomRect",
        x: 0,
        y: 0,
        w: 100,
        h: 80,
        wallCm: { top: 10, right: 0, bottom: 0, left: 0 },
        roomId: "room_a"
      },
      {
        id: "rect_b",
        kind: "roomRect",
        x: 120,
        y: 0,
        w: 100,
        h: 80,
        wallCm: { top: 10, right: 0, bottom: 0, left: 0 },
        roomId: "room_b"
      }
    ],
    [
      { id: "room_a", name: "Living", roomType: "generic", rectangleIds: ["rect_a"] },
      { id: "room_b", name: "Bath", roomType: "bathroom", rectangleIds: ["rect_b"] }
    ]
  );

  const baseboard = deriveBaseboardCandidates(plan);
  const snapshot = deriveBaseboardExportSnapshot(baseboard, {
    computedAt: "2026-03-02T12:00:00.000Z"
  });

  assertEqual(snapshot.algoVersion, BASEBOARD_ALGO_VERSION);
  assertEqual(snapshot.computedAt, "2026-03-02T12:00:00.000Z");
  assertEqual(snapshot.counts.rawSegmentCount, 2);
  assertEqual(snapshot.counts.countedSegmentCount, 1);
  assertEqual(snapshot.counts.excludedSegmentCount, 1);
  assertClose(snapshot.lengths.raw.world, 200);
  assertClose(snapshot.lengths.counted.world, 100);
  assertClose(snapshot.lengths.excluded.world, 100);
  assertEqual(snapshot.segments.raw.length, 2);
  assertEqual(snapshot.segments.counted.length, 1);
  assertEqual(snapshot.segments.excluded.length, 1);
});

test("baseboard export snapshot emits empty-safe structure", () => {
  const snapshot = deriveBaseboardExportSnapshot(null, {
    computedAt: "2026-03-02T00:00:00.000Z"
  });
  assertEqual(snapshot.algoVersion, BASEBOARD_ALGO_VERSION);
  assertEqual(snapshot.computedAt, "2026-03-02T00:00:00.000Z");
  assertDeepEqual(snapshot.counts, {
    candidateSegmentCount: 0,
    rawSegmentCount: 0,
    countedSegmentCount: 0,
    excludedSegmentCount: 0,
    prunedSegmentCount: 0,
    sharedBoundaryCount: 0,
    unsupportedOpenSideCount: 0
  });
  assertDeepEqual(snapshot.lengths, {
    candidate: { world: null, meters: null },
    raw: { world: null, meters: null },
    counted: { world: null, meters: null },
    excluded: { world: null, meters: null },
    pruned: { world: null, meters: null }
  });
  assertEqual(snapshot.segments.candidates.length, 0);
  assertEqual(snapshot.segments.raw.length, 0);
  assertEqual(snapshot.segments.counted.length, 0);
  assertEqual(snapshot.segments.excluded.length, 0);
  assertEqual(snapshot.segments.unsupportedOpenSides.length, 0);
  assertEqual(snapshot.sharedBoundaries.length, 0);
});
