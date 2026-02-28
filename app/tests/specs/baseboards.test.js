import { deriveBaseboardCandidates, deriveRoomWallContactModel } from "../../src/editor/geometry/baseboards.js";
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

test("room-wall contact model exposes normalized contact segments", () => {
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
      id: "room_b",
      kind: "roomRect",
      x: 120,
      y: 0,
      w: 100,
      h: 80,
      wallCm: { top: 0, right: 0, bottom: 0, left: 10 },
      roomId: "room_b"
    }
  ]);

  const model = deriveRoomWallContactModel(plan);
  const inheritedContacts = model.roomWallContacts.filter(
    (segment) => segment.rectangleId === "room_a" && segment.side === "right"
  );

  assertEqual(inheritedContacts.length, 1);
  assertEqual(inheritedContacts[0].wallSource, "neighborWall");
  assertClose(inheritedContacts[0].lengthWorld, 80);
});
