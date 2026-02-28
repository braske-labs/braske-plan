import { deriveRoomWallDecomposition } from "../../src/editor/geometry/room-wall-topology.js";
import { assertClose, assertEqual, test } from "../test-runner.js";

function createPlan(rectangles, metersPerWorldUnit = 0.01) {
  return {
    scale: {
      metersPerWorldUnit,
      referenceLine: null
    },
    entities: {
      rectangles
    }
  };
}

test("room-wall topology decomposes rectangles into room and wall sets", () => {
  const plan = createPlan([
    {
      id: "room_a",
      kind: "roomRect",
      x: 0,
      y: 0,
      w: 120,
      h: 80,
      wallCm: { top: 10, right: 0, bottom: 0, left: 0 },
      roomId: "room_a"
    },
    {
      id: "outer_wall",
      kind: "wallRect",
      x: 0,
      y: -20,
      w: 120,
      h: 20
    },
    {
      id: "invalid_shape",
      kind: "roomRect",
      x: 10,
      y: 10,
      w: 0,
      h: 20
    }
  ]);

  const decomposition = deriveRoomWallDecomposition(plan);

  assertEqual(decomposition.roomRectangleCount, 1);
  assertEqual(decomposition.wallRectangleCount, 1);
  assertEqual(decomposition.derivedWallRectangleCount, 1);
  assertEqual(decomposition.wallRectangles.length, 2);
  assertEqual(decomposition.roomSides.length, 4);

  const topSide = decomposition.roomSides.find((side) => side.rectangleId === "room_a" && side.side === "top");
  assertEqual(topSide.hasWallCm, true);
  assertEqual(topSide.wallCm, 10);
  assertClose(topSide.coordinateOuter, -10);
});

test("room-wall topology honors tolerance and scale defaults", () => {
  const plan = createPlan([
    {
      id: "room_a",
      kind: "roomRect",
      x: 0,
      y: 0,
      w: 120,
      h: 80,
      wallCm: { top: 0, right: 0, bottom: 0, left: 0 },
      roomId: "room_a"
    }
  ], null);

  const decomposition = deriveRoomWallDecomposition(plan, {
    touchToleranceWorld: 2,
    overlapToleranceWorld: 0.5
  });

  assertEqual(decomposition.touchToleranceWorld, 2);
  assertEqual(decomposition.overlapToleranceWorld, 0.5);
  assertEqual(decomposition.metersPerWorldUnit, null);
});
