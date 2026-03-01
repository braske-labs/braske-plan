import {
  deriveLockedSeamSides,
  deriveRoomSeams,
  deriveTouchingAdjacency,
  isConnectedSelection
} from "../../src/editor/geometry/room-merge.js";
import { assert, assertEqual, test } from "../test-runner.js";

function createPlan(rectangles, metersPerWorldUnit = 0.01) {
  return {
    scale: {
      metersPerWorldUnit,
      referenceLine: null
    },
    entities: {
      rectangles,
      openings: [],
      rooms: []
    }
  };
}

test("room-merge adjacency detects touching and connected selections", () => {
  const rectangles = [
    { id: "rect_a", kind: "roomRect", x: 0, y: 0, w: 100, h: 80, wallCm: { top: 0, right: 0, bottom: 0, left: 0 } },
    { id: "rect_b", kind: "roomRect", x: 100, y: 10, w: 80, h: 50, wallCm: { top: 0, right: 0, bottom: 0, left: 0 } },
    { id: "rect_c", kind: "roomRect", x: 260, y: 0, w: 90, h: 90, wallCm: { top: 0, right: 0, bottom: 0, left: 0 } }
  ];

  const adjacency = deriveTouchingAdjacency(rectangles);

  assert(adjacency.get("rect_a")?.has("rect_b"), "rect_a should touch rect_b.");
  assert(adjacency.get("rect_b")?.has("rect_a"), "rect_b should touch rect_a.");
  assertEqual(adjacency.get("rect_a")?.has("rect_c") ?? false, false);
  assertEqual(isConnectedSelection(["rect_a", "rect_b"], adjacency), true);
  assertEqual(isConnectedSelection(["rect_a", "rect_c"], adjacency), false);
});

test("room-merge seams classify full and partial shared sides", () => {
  const plan = createPlan([
    { id: "rect_a", kind: "roomRect", x: 0, y: 0, w: 100, h: 100, wallCm: { top: 0, right: 0, bottom: 0, left: 0 }, roomId: "room_l" },
    { id: "rect_b", kind: "roomRect", x: 100, y: 40, w: 80, h: 60, wallCm: { top: 0, right: 0, bottom: 0, left: 0 }, roomId: "room_l" },
    { id: "rect_c", kind: "roomRect", x: 40, y: 100, w: 60, h: 80, wallCm: { top: 0, right: 0, bottom: 0, left: 0 }, roomId: "room_l" }
  ]);

  const roomSeams = deriveRoomSeams(plan, "room_l");
  const seamAB = roomSeams.seams.find((seam) => seam.rectangleAId === "rect_a" && seam.rectangleBId === "rect_b");
  const seamAC = roomSeams.seams.find((seam) => seam.rectangleAId === "rect_a" && seam.rectangleBId === "rect_c");

  assertEqual(roomSeams.seamCount, 2);
  assert(seamAB != null, "A-B seam should exist.");
  assert(seamAC != null, "A-C seam should exist.");
  assertEqual(seamAB.fullA, false);
  assertEqual(seamAB.fullB, true);
  assertEqual(seamAC.fullA, false);
  assertEqual(seamAC.fullB, true);
});

test("deriveLockedSeamSides marks both sides when seam covers full edge", () => {
  const plan = createPlan([
    { id: "rect_a", kind: "roomRect", x: 0, y: 0, w: 100, h: 80, wallCm: { top: 0, right: 0, bottom: 0, left: 0 }, roomId: "room_shared" },
    { id: "rect_b", kind: "roomRect", x: 100, y: 0, w: 120, h: 80, wallCm: { top: 0, right: 0, bottom: 0, left: 0 }, roomId: "room_shared" }
  ]);

  const lockedSides = deriveLockedSeamSides(plan);
  const rectASides = lockedSides.get("rect_a");
  const rectBSides = lockedSides.get("rect_b");

  assert(rectASides?.has("right"), "rect_a right side should be locked.");
  assert(rectBSides?.has("left"), "rect_b left side should be locked.");
  assertEqual(rectASides?.has("left") ?? false, false);
});

test("deriveLockedSeamSides does not lock partial side contacts", () => {
  const plan = createPlan([
    { id: "rect_a", kind: "roomRect", x: 0, y: 0, w: 100, h: 100, wallCm: { top: 0, right: 0, bottom: 0, left: 0 }, roomId: "room_partial" },
    { id: "rect_b", kind: "roomRect", x: 100, y: 50, w: 80, h: 50, wallCm: { top: 0, right: 0, bottom: 0, left: 0 }, roomId: "room_partial" }
  ]);

  const lockedSides = deriveLockedSeamSides(plan);
  const rectASides = lockedSides.get("rect_a");

  assertEqual(rectASides?.has("right") ?? false, false);
});
