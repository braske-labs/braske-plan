import { createEmptyPlan, planReducer } from "../../src/editor/state/plan.js";
import { assert, assertDeepEqual, assertEqual, test } from "../test-runner.js";

test("plan reducer delete is a no-op when rectangle id is missing", () => {
  const plan = createEmptyPlan();
  const nextPlan = planReducer(plan, {
    type: "plan/rectangles/delete",
    rectangleId: "rect_missing"
  });

  assert(nextPlan === plan, "Missing delete should return the same plan object.");
});

test("plan reducer delete removes rectangle and cleans rooms/openings references", () => {
  const base = createEmptyPlan();
  const plan = {
    ...base,
    entities: {
      rectangles: [
        { id: "rect_a", kind: "roomRect", x: 0, y: 0, w: 100, h: 100, wallCm: { top: 0, right: 0, bottom: 0, left: 0 }, roomId: "room_keep", label: null },
        { id: "rect_b", kind: "roomRect", x: 120, y: 0, w: 80, h: 100, wallCm: { top: 0, right: 0, bottom: 0, left: 0 }, roomId: "room_keep", label: null }
      ],
      openings: [
        { id: "open_1", host: { rectangleId: "rect_a", edge: "right" } },
        { id: "open_2", host: { rectangleId: "rect_b", edge: "left" } }
      ],
      rooms: [
        { id: "room_keep", name: "Living", roomType: "living_room", rectangleIds: ["rect_a", "rect_b"] },
        { id: "room_drop", name: "Closet", roomType: "closet", rectangleIds: ["rect_a"] }
      ]
    }
  };

  const nextPlan = planReducer(plan, {
    type: "plan/rectangles/delete",
    rectangleId: "rect_a"
  });

  assert(nextPlan !== plan, "Delete should produce a new plan object.");
  assertEqual(nextPlan.entities.rectangles.length, 1);
  assertEqual(nextPlan.entities.rectangles[0].id, "rect_b");
  assertEqual(nextPlan.entities.openings.length, 1);
  assertEqual(nextPlan.entities.openings[0].id, "open_2");
  assertEqual(nextPlan.entities.rooms.length, 1);
  assertDeepEqual(nextPlan.entities.rooms[0], {
    id: "room_keep",
    name: "Living",
    roomType: "living_room",
    rectangleIds: ["rect_b"]
  });
});

test("plan reducer setWallCm updates selected rectangle side value", () => {
  const base = createEmptyPlan();
  const plan = {
    ...base,
    entities: {
      ...base.entities,
      rectangles: [
        { id: "rect_a", kind: "roomRect", x: 0, y: 0, w: 100, h: 80, wallCm: { top: 8, right: 10, bottom: 12, left: 9 }, roomId: null, label: null }
      ]
    }
  };

  const nextPlan = planReducer(plan, {
    type: "plan/rectangles/setWallCm",
    rectangleId: "rect_a",
    side: "right",
    value: 15
  });

  assert(nextPlan !== plan, "setWallCm should produce a new plan object.");
  assertEqual(nextPlan.entities.rectangles[0].wallCm.right, 15);
  assertEqual(nextPlan.entities.rectangles[0].wallCm.top, 8);
});

test("plan reducer setWallCm no-ops for missing rectangle or invalid side", () => {
  const base = createEmptyPlan();
  const plan = {
    ...base,
    entities: {
      ...base.entities,
      rectangles: [
        { id: "rect_a", kind: "roomRect", x: 0, y: 0, w: 100, h: 80, wallCm: { top: 8, right: 10, bottom: 12, left: 9 }, roomId: null, label: null }
      ]
    }
  };

  const missingRect = planReducer(plan, {
    type: "plan/rectangles/setWallCm",
    rectangleId: "rect_missing",
    side: "top",
    value: 10
  });
  assert(missingRect === plan, "setWallCm should no-op for missing rectangle.");

  const invalidSide = planReducer(plan, {
    type: "plan/rectangles/setWallCm",
    rectangleId: "rect_a",
    side: "diagonal",
    value: 10
  });
  assert(invalidSide === plan, "setWallCm should no-op for invalid side.");
});

test("plan reducer setKind updates rectangle kind and clears wallCm for wallRect", () => {
  const base = createEmptyPlan();
  const plan = {
    ...base,
    entities: {
      ...base.entities,
      rectangles: [
        { id: "rect_a", kind: "roomRect", x: 0, y: 0, w: 120, h: 80, wallCm: { top: 5, right: 7, bottom: 9, left: 11 }, roomId: null, label: null }
      ]
    }
  };

  const nextPlan = planReducer(plan, {
    type: "plan/rectangles/setKind",
    rectangleId: "rect_a",
    kind: "wallRect"
  });

  assert(nextPlan !== plan, "setKind should produce a new plan object.");
  assertEqual(nextPlan.entities.rectangles[0].kind, "wallRect");
  assertDeepEqual(nextPlan.entities.rectangles[0].wallCm, { top: 0, right: 0, bottom: 0, left: 0 });
});

test("plan reducer setKind no-ops for missing rectangle or invalid kind", () => {
  const base = createEmptyPlan();
  const plan = {
    ...base,
    entities: {
      ...base.entities,
      rectangles: [
        { id: "rect_a", kind: "roomRect", x: 0, y: 0, w: 120, h: 80, wallCm: { top: 1, right: 1, bottom: 1, left: 1 }, roomId: null, label: null }
      ]
    }
  };

  const missingRect = planReducer(plan, {
    type: "plan/rectangles/setKind",
    rectangleId: "rect_missing",
    kind: "wallRect"
  });
  assert(missingRect === plan, "setKind should no-op for missing rectangle.");

  const invalidKind = planReducer(plan, {
    type: "plan/rectangles/setKind",
    rectangleId: "rect_a",
    kind: "diagonalRect"
  });
  assert(invalidKind === plan, "setKind should no-op for invalid kind.");
});
