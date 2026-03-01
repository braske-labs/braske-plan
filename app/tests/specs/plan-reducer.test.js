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

test("plan reducer setMetersPerWorldUnit sets scale and clears reference line", () => {
  const base = createEmptyPlan();
  const plan = {
    ...base,
    scale: {
      metersPerWorldUnit: 0.02,
      referenceLine: {
        x0: 10,
        y0: 20,
        x1: 110,
        y1: 20,
        meters: 2
      }
    }
  };

  const nextPlan = planReducer(plan, {
    type: "plan/scale/setMetersPerWorldUnit",
    metersPerWorldUnit: 0.015
  });

  assert(nextPlan !== plan, "setMetersPerWorldUnit should produce a new plan object.");
  assertEqual(nextPlan.scale.metersPerWorldUnit, 0.015);
  assertEqual(nextPlan.scale.referenceLine, null);
});

test("plan reducer setKind updates rectangle kind and clears wallCm for wallRect", () => {
  const base = createEmptyPlan();
  const plan = {
    ...base,
    entities: {
      ...base.entities,
      rectangles: [
        { id: "rect_a", kind: "roomRect", x: 0, y: 0, w: 120, h: 80, wallCm: { top: 5, right: 7, bottom: 9, left: 11 }, roomId: "room_a", label: null }
      ],
      rooms: [
        { id: "room_a", name: "Bathroom", roomType: "bathroom", rectangleIds: ["rect_a"] }
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
  assertEqual(nextPlan.entities.rectangles[0].roomId, null);
  assertEqual(nextPlan.entities.rooms.length, 0);
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

test("plan reducer setManyGeometry updates multiple rectangles atomically", () => {
  const base = createEmptyPlan();
  const plan = {
    ...base,
    entities: {
      ...base.entities,
      rectangles: [
        { id: "rect_a", kind: "roomRect", x: 0, y: 0, w: 100, h: 80, wallCm: { top: 0, right: 0, bottom: 0, left: 0 }, roomId: null, label: null },
        { id: "rect_b", kind: "roomRect", x: 110, y: 0, w: 90, h: 70, wallCm: { top: 0, right: 0, bottom: 0, left: 0 }, roomId: null, label: null }
      ]
    }
  };

  const nextPlan = planReducer(plan, {
    type: "plan/rectangles/setManyGeometry",
    rectangles: [
      { id: "rect_a", x: 10, y: 20, w: 120, h: 90 },
      { id: "rect_b", x: 130, y: 20, w: 70, h: 90 }
    ]
  });

  assert(nextPlan !== plan, "setManyGeometry should produce a new plan object.");
  assertDeepEqual(nextPlan.entities.rectangles.find((rectangle) => rectangle.id === "rect_a"), {
    id: "rect_a",
    kind: "roomRect",
    x: 10,
    y: 20,
    w: 120,
    h: 90,
    wallCm: { top: 0, right: 0, bottom: 0, left: 0 },
    roomId: null,
    label: null
  });
  assertDeepEqual(nextPlan.entities.rectangles.find((rectangle) => rectangle.id === "rect_b"), {
    id: "rect_b",
    kind: "roomRect",
    x: 130,
    y: 20,
    w: 70,
    h: 90,
    wallCm: { top: 0, right: 0, bottom: 0, left: 0 },
    roomId: null,
    label: null
  });
});

test("plan reducer room upsert assigns selected rectangle to a room", () => {
  const base = createEmptyPlan();
  const plan = {
    ...base,
    entities: {
      ...base.entities,
      rectangles: [
        { id: "rect_a", kind: "roomRect", x: 0, y: 0, w: 100, h: 80, wallCm: { top: 0, right: 0, bottom: 0, left: 0 }, roomId: null, label: null }
      ]
    }
  };

  const nextPlan = planReducer(plan, {
    type: "plan/rooms/upsertForRectangle",
    rectangleId: "rect_a",
    name: "Bathroom",
    roomType: "bathroom"
  });

  assert(nextPlan !== plan, "room upsert should produce a new plan object.");
  assertEqual(nextPlan.entities.rooms.length, 1);
  assertEqual(nextPlan.entities.rooms[0].name, "Bathroom");
  assertEqual(nextPlan.entities.rooms[0].roomType, "bathroom");
  assertDeepEqual(nextPlan.entities.rooms[0].rectangleIds, ["rect_a"]);
  assertEqual(nextPlan.entities.rectangles[0].roomId, nextPlan.entities.rooms[0].id);
});

test("plan reducer room upsert updates existing room and moves rectangle", () => {
  const base = createEmptyPlan();
  const plan = {
    ...base,
    entities: {
      ...base.entities,
      rectangles: [
        { id: "rect_a", kind: "roomRect", x: 0, y: 0, w: 90, h: 80, wallCm: { top: 0, right: 0, bottom: 0, left: 0 }, roomId: "room_old", label: null },
        { id: "rect_b", kind: "roomRect", x: 100, y: 0, w: 90, h: 80, wallCm: { top: 0, right: 0, bottom: 0, left: 0 }, roomId: "room_keep", label: null }
      ],
      rooms: [
        { id: "room_old", name: "Old", roomType: "generic", rectangleIds: ["rect_a"] },
        { id: "room_keep", name: "Living", roomType: "living_room", rectangleIds: ["rect_b"] }
      ]
    }
  };

  const nextPlan = planReducer(plan, {
    type: "plan/rooms/upsertForRectangle",
    rectangleId: "rect_a",
    roomId: "room_keep",
    name: "Living Area",
    roomType: "living_room"
  });

  assertEqual(nextPlan.entities.rooms.length, 1);
  assertEqual(nextPlan.entities.rooms[0].id, "room_keep");
  assertEqual(nextPlan.entities.rooms[0].name, "Living Area");
  assertDeepEqual(nextPlan.entities.rooms[0].rectangleIds, ["rect_b", "rect_a"]);
  const rectA = nextPlan.entities.rectangles.find((rectangle) => rectangle.id === "rect_a");
  assertEqual(rectA.roomId, "room_keep");
});

test("plan reducer room clear removes assignment and prunes empty room", () => {
  const base = createEmptyPlan();
  const plan = {
    ...base,
    entities: {
      ...base.entities,
      rectangles: [
        { id: "rect_a", kind: "roomRect", x: 0, y: 0, w: 90, h: 80, wallCm: { top: 0, right: 0, bottom: 0, left: 0 }, roomId: "room_a", label: null }
      ],
      rooms: [
        { id: "room_a", name: "Bathroom", roomType: "bathroom", rectangleIds: ["rect_a"] }
      ]
    }
  };

  const nextPlan = planReducer(plan, {
    type: "plan/rooms/clearForRectangle",
    rectangleId: "rect_a"
  });

  assertEqual(nextPlan.entities.rectangles[0].roomId, null);
  assertEqual(nextPlan.entities.rooms.length, 0);
});

test("plan reducer mergeRectangles merges touching room rectangles into one room", () => {
  const base = createEmptyPlan();
  const plan = {
    ...base,
    entities: {
      ...base.entities,
      rectangles: [
        { id: "rect_a", kind: "roomRect", x: 0, y: 0, w: 100, h: 80, wallCm: { top: 0, right: 0, bottom: 0, left: 0 }, roomId: null, label: null },
        { id: "rect_b", kind: "roomRect", x: 100, y: 0, w: 120, h: 80, wallCm: { top: 0, right: 0, bottom: 0, left: 0 }, roomId: null, label: null }
      ]
    }
  };

  const nextPlan = planReducer(plan, {
    type: "plan/rooms/mergeRectangles",
    rectangleIds: ["rect_a", "rect_b"],
    name: "Living Area",
    roomType: "living_room"
  });

  assert(nextPlan !== plan, "mergeRectangles should produce a new plan object.");
  assertEqual(nextPlan.entities.rooms.length, 1);
  assertEqual(nextPlan.entities.rooms[0].name, "Living Area");
  assertEqual(nextPlan.entities.rooms[0].roomType, "living_room");
  assertDeepEqual(nextPlan.entities.rooms[0].rectangleIds.sort(), ["rect_a", "rect_b"]);
  const rectA = nextPlan.entities.rectangles.find((rectangle) => rectangle.id === "rect_a");
  const rectB = nextPlan.entities.rectangles.find((rectangle) => rectangle.id === "rect_b");
  assertEqual(rectA.roomId, nextPlan.entities.rooms[0].id);
  assertEqual(rectB.roomId, nextPlan.entities.rooms[0].id);
});

test("plan reducer mergeRectangles allows empty name and uses fallback", () => {
  const base = createEmptyPlan();
  const plan = {
    ...base,
    entities: {
      ...base.entities,
      rectangles: [
        { id: "rect_a", kind: "roomRect", x: 0, y: 0, w: 100, h: 80, wallCm: { top: 0, right: 0, bottom: 0, left: 0 }, roomId: null, label: null },
        { id: "rect_b", kind: "roomRect", x: 100, y: 0, w: 120, h: 80, wallCm: { top: 0, right: 0, bottom: 0, left: 0 }, roomId: null, label: null }
      ]
    }
  };

  const nextPlan = planReducer(plan, {
    type: "plan/rooms/mergeRectangles",
    rectangleIds: ["rect_a", "rect_b"],
    name: "",
    roomType: "generic"
  });

  assert(nextPlan !== plan, "mergeRectangles should allow empty name.");
  assertEqual(nextPlan.entities.rooms.length, 1);
  assertEqual(nextPlan.entities.rooms[0].name, "Merged Room");
  assertEqual(nextPlan.entities.rectangles.find((rectangle) => rectangle.id === "rect_a")?.roomId, nextPlan.entities.rooms[0].id);
  assertEqual(nextPlan.entities.rectangles.find((rectangle) => rectangle.id === "rect_b")?.roomId, nextPlan.entities.rooms[0].id);
});

test("plan reducer mergeRectangles preserves existing room type when type is omitted", () => {
  const base = createEmptyPlan();
  const plan = {
    ...base,
    entities: {
      ...base.entities,
      rectangles: [
        { id: "rect_a", kind: "roomRect", x: 0, y: 0, w: 100, h: 80, wallCm: { top: 0, right: 0, bottom: 0, left: 0 }, roomId: "room_living", label: null },
        { id: "rect_b", kind: "roomRect", x: 100, y: 0, w: 120, h: 80, wallCm: { top: 0, right: 0, bottom: 0, left: 0 }, roomId: "room_living", label: null }
      ],
      rooms: [
        { id: "room_living", name: "Living", roomType: "living_room", rectangleIds: ["rect_a"] }
      ]
    }
  };

  const nextPlan = planReducer(plan, {
    type: "plan/rooms/mergeRectangles",
    rectangleIds: ["rect_a", "rect_b"]
  });

  assert(nextPlan !== plan, "mergeRectangles should merge without explicit room type.");
  assertEqual(nextPlan.entities.rooms.length, 1);
  assertEqual(nextPlan.entities.rooms[0].roomType, "living_room");
  assertDeepEqual(nextPlan.entities.rooms[0].rectangleIds.sort(), ["rect_a", "rect_b"]);
});

test("plan reducer mergeRectangles detaches selected rectangles from prior rooms", () => {
  const base = createEmptyPlan();
  const plan = {
    ...base,
    entities: {
      ...base.entities,
      rectangles: [
        { id: "rect_a", kind: "roomRect", x: 0, y: 0, w: 100, h: 90, wallCm: { top: 0, right: 0, bottom: 0, left: 0 }, roomId: "room_a", label: null },
        { id: "rect_b", kind: "roomRect", x: 100, y: 0, w: 80, h: 90, wallCm: { top: 0, right: 0, bottom: 0, left: 0 }, roomId: "room_b", label: null },
        { id: "rect_c", kind: "roomRect", x: 240, y: 0, w: 90, h: 90, wallCm: { top: 0, right: 0, bottom: 0, left: 0 }, roomId: "room_keep", label: null }
      ],
      rooms: [
        { id: "room_a", name: "A", roomType: "generic", rectangleIds: ["rect_a"] },
        { id: "room_b", name: "B", roomType: "generic", rectangleIds: ["rect_b"] },
        { id: "room_keep", name: "Keep", roomType: "generic", rectangleIds: ["rect_c"] }
      ]
    }
  };

  const nextPlan = planReducer(plan, {
    type: "plan/rooms/mergeRectangles",
    rectangleIds: ["rect_a", "rect_b"],
    name: "Merged",
    roomType: "bathroom"
  });

  assertEqual(nextPlan.entities.rooms.length, 2);
  const mergedRoom = nextPlan.entities.rooms.find((room) => room.name === "Merged");
  const keptRoom = nextPlan.entities.rooms.find((room) => room.id === "room_keep");
  assert(mergedRoom != null, "Merged room should exist.");
  assert(keptRoom != null, "Unselected room should remain.");
  assertDeepEqual(mergedRoom.rectangleIds.sort(), ["rect_a", "rect_b"]);
  assertDeepEqual(keptRoom.rectangleIds, ["rect_c"]);
});

test("plan reducer mergeRectangles no-ops for invalid ids, kinds, or disconnected selection", () => {
  const base = createEmptyPlan();
  const plan = {
    ...base,
    entities: {
      ...base.entities,
      rectangles: [
        { id: "rect_a", kind: "roomRect", x: 0, y: 0, w: 100, h: 100, wallCm: { top: 0, right: 0, bottom: 0, left: 0 }, roomId: null, label: null },
        { id: "rect_b", kind: "roomRect", x: 220, y: 0, w: 100, h: 100, wallCm: { top: 0, right: 0, bottom: 0, left: 0 }, roomId: null, label: null },
        { id: "rect_wall", kind: "wallRect", x: 100, y: 0, w: 20, h: 100, wallCm: { top: 0, right: 0, bottom: 0, left: 0 }, roomId: null, label: null }
      ]
    }
  };

  const missingRect = planReducer(plan, {
    type: "plan/rooms/mergeRectangles",
    rectangleIds: ["rect_a", "rect_missing"],
    name: "Merged",
    roomType: "generic"
  });
  assert(missingRect === plan, "mergeRectangles should no-op when id is missing.");

  const invalidKind = planReducer(plan, {
    type: "plan/rooms/mergeRectangles",
    rectangleIds: ["rect_a", "rect_wall"],
    name: "Merged",
    roomType: "generic"
  });
  assert(invalidKind === plan, "mergeRectangles should no-op when selection includes wallRect.");

  const disconnected = planReducer(plan, {
    type: "plan/rooms/mergeRectangles",
    rectangleIds: ["rect_a", "rect_b"],
    name: "Merged",
    roomType: "generic"
  });
  assert(disconnected === plan, "mergeRectangles should no-op for disconnected selection.");
});

test("plan reducer dissolveRoom clears members and removes room entity", () => {
  const base = createEmptyPlan();
  const plan = {
    ...base,
    entities: {
      ...base.entities,
      rectangles: [
        { id: "rect_a", kind: "roomRect", x: 0, y: 0, w: 100, h: 80, wallCm: { top: 0, right: 0, bottom: 0, left: 0 }, roomId: "room_a", label: null },
        { id: "rect_b", kind: "roomRect", x: 100, y: 0, w: 100, h: 80, wallCm: { top: 0, right: 0, bottom: 0, left: 0 }, roomId: "room_a", label: null },
        { id: "rect_c", kind: "roomRect", x: 210, y: 0, w: 100, h: 80, wallCm: { top: 0, right: 0, bottom: 0, left: 0 }, roomId: "room_keep", label: null }
      ],
      rooms: [
        { id: "room_a", name: "Dissolve me", roomType: "generic", rectangleIds: ["rect_a", "rect_b"] },
        { id: "room_keep", name: "Keep", roomType: "generic", rectangleIds: ["rect_c"] }
      ]
    }
  };

  const nextPlan = planReducer(plan, {
    type: "plan/rooms/dissolveRoom",
    roomId: "room_a"
  });

  assertEqual(nextPlan.entities.rooms.length, 1);
  assertEqual(nextPlan.entities.rooms[0].id, "room_keep");
  assertEqual(nextPlan.entities.rectangles.find((rectangle) => rectangle.id === "rect_a")?.roomId, null);
  assertEqual(nextPlan.entities.rectangles.find((rectangle) => rectangle.id === "rect_b")?.roomId, null);
  assertEqual(nextPlan.entities.rectangles.find((rectangle) => rectangle.id === "rect_c")?.roomId, "room_keep");
});

test("plan reducer merge and dissolve keep room membership consistent", () => {
  const base = createEmptyPlan();
  const plan = {
    ...base,
    entities: {
      ...base.entities,
      rectangles: [
        { id: "rect_a", kind: "roomRect", x: 0, y: 0, w: 100, h: 80, wallCm: { top: 0, right: 0, bottom: 0, left: 0 }, roomId: null, label: null },
        { id: "rect_b", kind: "roomRect", x: 100, y: 0, w: 100, h: 80, wallCm: { top: 0, right: 0, bottom: 0, left: 0 }, roomId: null, label: null },
        { id: "rect_c", kind: "roomRect", x: 200, y: 0, w: 100, h: 80, wallCm: { top: 0, right: 0, bottom: 0, left: 0 }, roomId: null, label: null }
      ]
    }
  };

  const merged = planReducer(plan, {
    type: "plan/rooms/mergeRectangles",
    rectangleIds: ["rect_a", "rect_b", "rect_c"],
    name: "Hall",
    roomType: "hallway"
  });
  const mergedRoom = merged.entities.rooms[0];
  assertDeepEqual(new Set(mergedRoom.rectangleIds).size, mergedRoom.rectangleIds.length, "Room rectangleIds should be deduplicated.");
  for (const rectangleId of mergedRoom.rectangleIds) {
    const rectangle = merged.entities.rectangles.find((candidate) => candidate.id === rectangleId);
    assertEqual(rectangle?.roomId, mergedRoom.id, "Rectangle roomId should point to owning room.");
  }

  const dissolved = planReducer(merged, {
    type: "plan/rooms/dissolveRoom",
    roomId: mergedRoom.id
  });
  assertEqual(dissolved.entities.rooms.length, 0);
  for (const rectangle of dissolved.entities.rectangles) {
    assertEqual(rectangle.roomId, null, "Room dissolve should clear roomId for all former members.");
  }
});
