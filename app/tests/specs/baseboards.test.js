import { deriveBaseboardCandidates } from "../../src/editor/geometry/baseboards.js";
import { assert, assertClose, assertEqual, test } from "../test-runner.js";

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

test("baseboard candidates include room sides with wallCm > 0", () => {
  const plan = createPlan([
    {
      id: "room_a",
      kind: "roomRect",
      x: 0,
      y: 0,
      w: 100,
      h: 80,
      wallCm: { top: 10, right: 10, bottom: 0, left: 10 },
      roomId: "room_a"
    }
  ]);

  const result = deriveBaseboardCandidates(plan);

  assertEqual(result.segmentCount, 3);
  assertClose(result.totalLengthWorld, 260);
  assertClose(result.totalLengthMeters, 2.6);
  assertEqual(result.unsupportedOpenSideCount, 1);
});

test("baseboard candidates use partial wallRect contact intervals when wallCm is zero", () => {
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
    },
    {
      id: "wall_outer_top",
      kind: "wallRect",
      x: 30,
      y: -20,
      w: 40,
      h: 20
    }
  ]);

  const result = deriveBaseboardCandidates(plan);
  assertEqual(result.segmentCount, 1);
  assertEqual(result.segments[0].side, "top");
  assertEqual(result.segments[0].wallSource, "wallRect");
  assertClose(result.segments[0].lengthWorld, 40);
  assertEqual(result.unsupportedOpenSideCount, 5);
  const topOpenSegments = result.unsupportedOpenSides.filter((segment) => segment.rectangleId === "room_a" && segment.side === "top");
  assertEqual(topOpenSegments.length, 2);
});

test("baseboard candidates ignore room sides without wall support", () => {
  const plan = createPlan([
    {
      id: "room_a",
      kind: "roomRect",
      x: 0,
      y: 0,
      w: 100,
      h: 60,
      wallCm: { top: 0, right: 0, bottom: 0, left: 0 },
      roomId: "room_a"
    }
  ]);

  const result = deriveBaseboardCandidates(plan);

  assertEqual(result.segmentCount, 0);
  assertClose(result.totalLengthWorld, 0);
  assertClose(result.totalLengthMeters, 0);
  assertEqual(result.unsupportedOpenSideCount, 4);
});

test("same-room shared boundaries are pruned from counted baseboard segments", () => {
  const plan = createPlan([
    {
      id: "room_a",
      kind: "roomRect",
      x: 0,
      y: 0,
      w: 60,
      h: 40,
      wallCm: { top: 0, right: 0, bottom: 0, left: 0 },
      roomId: "room_merged"
    },
    {
      id: "room_b",
      kind: "roomRect",
      x: 60,
      y: 0,
      w: 40,
      h: 40,
      wallCm: { top: 0, right: 0, bottom: 0, left: 0 },
      roomId: "room_merged"
    },
    {
      id: "wall_touch_a_right",
      kind: "wallRect",
      x: 60,
      y: 0,
      w: 10,
      h: 40
    },
    {
      id: "wall_touch_b_left",
      kind: "wallRect",
      x: 50,
      y: 0,
      w: 10,
      h: 40
    }
  ]);

  const result = deriveBaseboardCandidates(plan);

  assertEqual(result.candidateSegmentCount, 2);
  assertEqual(result.segmentCount, 0);
  assertEqual(result.sharedBoundaryCount, 1);
  assertClose(result.prunedLengthWorld, 80);
});

test("unsupported open side segments exclude areas covered by neighboring supported boundary", () => {
  const plan = createPlan([
    {
      id: "room_a",
      kind: "roomRect",
      x: 0,
      y: 0,
      w: 100,
      h: 80,
      wallCm: { top: 0, right: 0, bottom: 0, left: 0 },
      roomId: "room_a"
    },
    {
      id: "room_b",
      kind: "roomRect",
      x: 100,
      y: 0,
      w: 120,
      h: 80,
      wallCm: { top: 0, right: 0, bottom: 0, left: 0 },
      roomId: "room_b"
    },
    {
      id: "wall_touch_b_left",
      kind: "wallRect",
      x: 90,
      y: 0,
      w: 10,
      h: 80
    }
  ]);

  const result = deriveBaseboardCandidates(plan);
  const roomARightUnsupported = result.unsupportedOpenSides.filter(
    (segment) => segment.rectangleId === "room_a" && segment.side === "right"
  );
  const roomARightBaseboardSegments = result.segments.filter(
    (segment) => segment.rectangleId === "room_a" && segment.side === "right"
  );

  assertEqual(roomARightUnsupported.length, 0);
  assertEqual(roomARightBaseboardSegments.length, 1);
  assertEqual(roomARightBaseboardSegments[0].wallSource, "neighborWall");
  assertClose(roomARightBaseboardSegments[0].lengthWorld, 80);
  assert(result.unsupportedOpenSideCount > 0);
});

test("room side inherits support from touching neighbor wallCm shell", () => {
  const plan = createPlan([
    {
      id: "room_a",
      kind: "roomRect",
      x: 10,
      y: 0,
      w: 80,
      h: 80,
      wallCm: { top: 0, right: 0, bottom: 0, left: 0 },
      roomId: "room_a"
    },
    {
      id: "room_b",
      kind: "roomRect",
      x: 100,
      y: 0,
      w: 120,
      h: 80,
      wallCm: { top: 0, right: 0, bottom: 0, left: 10 },
      roomId: "room_b"
    }
  ]);

  const result = deriveBaseboardCandidates(plan);
  const roomARightSegments = result.segments.filter(
    (segment) => segment.rectangleId === "room_a" && segment.side === "right"
  );

  assertEqual(roomARightSegments.length, 1);
  assertEqual(roomARightSegments[0].wallSource, "neighborWall");
  assertClose(roomARightSegments[0].lengthWorld, 80);
});

test("room side inherits support when positioned inside neighboring wall band", () => {
  const plan = createPlan([
    {
      id: "room_with_wall",
      kind: "roomRect",
      x: 0,
      y: 0,
      w: 100,
      h: 80,
      wallCm: { top: 0, right: 10, bottom: 0, left: 0 },
      roomId: "room_with_wall"
    },
    {
      id: "room_without_wall",
      kind: "roomRect",
      x: 108,
      y: 0,
      w: 100,
      h: 80,
      wallCm: { top: 0, right: 0, bottom: 0, left: 0 },
      roomId: "room_without_wall"
    }
  ]);

  const result = deriveBaseboardCandidates(plan);
  const inheritedSegments = result.segments.filter(
    (segment) => segment.rectangleId === "room_without_wall" && segment.side === "left"
  );
  const unsupportedLeft = result.unsupportedOpenSides.filter(
    (segment) => segment.rectangleId === "room_without_wall" && segment.side === "left"
  );

  assertEqual(inheritedSegments.length, 1);
  assertEqual(inheritedSegments[0].wallSource, "neighborWall");
  assertClose(inheritedSegments[0].lengthWorld, 80);
  assertEqual(unsupportedLeft.length, 0);
});

test("baseboard exists between room_room1 and room_room2 from exported plan geometry", () => {
  const plan = createPlan(
    [
      {
        id: "rect_user_8",
        kind: "roomRect",
        x: 147.4587000155098,
        y: 457.23128201188615,
        w: 172.22880020847214,
        h: 221.0565439133826,
        wallCm: { top: 0, right: 21, bottom: 0, left: 0 },
        roomId: "room_room1"
      },
      {
        id: "rect_user_9",
        kind: "roomRect",
        x: 330.91022434721583,
        y: 457.23128201188615,
        w: 111.60870055403649,
        h: 249.86738012239402,
        wallCm: { top: 0, right: 0, bottom: 0, left: 0 },
        roomId: "room_room2"
      }
    ],
    0.0187120344128612
  );

  const result = deriveBaseboardCandidates(plan);
  const room2LeftSegments = result.segments.filter(
    (segment) => segment.rectangleId === "rect_user_9" && segment.side === "left"
  );

  assertEqual(room2LeftSegments.length, 1);
  assertEqual(room2LeftSegments[0].wallSource, "neighborWall");
  assertClose(room2LeftSegments[0].x0, 330.91022434721583);
  assertClose(room2LeftSegments[0].y0, 457.23128201188615);
  assertClose(room2LeftSegments[0].y1, 678.2878259252687);
});

test("corner overlap from dual wallCm keeps near-corner interval on touching room side", () => {
  const plan = createPlan([
    {
      id: "room_with_dual_walls",
      kind: "roomRect",
      x: 0,
      y: 10,
      w: 100,
      h: 100,
      wallCm: { top: 10, right: 10, bottom: 0, left: 0 },
      roomId: "room_with_dual_walls"
    },
    {
      id: "room_touching_right_wall",
      kind: "roomRect",
      x: 110,
      y: 0,
      w: 80,
      h: 120,
      wallCm: { top: 0, right: 0, bottom: 0, left: 0 },
      roomId: "room_touching_right_wall"
    }
  ]);

  const result = deriveBaseboardCandidates(plan);
  const touchingLeftSegments = result.segments.filter(
    (segment) => segment.rectangleId === "room_touching_right_wall" && segment.side === "left"
  );

  assertEqual(touchingLeftSegments.length, 1);
  assertEqual(touchingLeftSegments[0].wallSource, "neighborWall");
  assertClose(touchingLeftSegments[0].y0, 0);
  assertClose(touchingLeftSegments[0].y1, 110);
});
