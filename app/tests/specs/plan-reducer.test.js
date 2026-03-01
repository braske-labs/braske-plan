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

test("createEmptyPlan includes lighting collections", () => {
  const plan = createEmptyPlan();
  assertDeepEqual(plan.entities.lighting, {
    fixtures: [],
    groups: [],
    links: []
  });
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

test("plan reducer lighting add fixture validates kind and host", () => {
  const base = createEmptyPlan();

  const invalidSwitch = planReducer(base, {
    type: "plan/lighting/addFixture",
    fixtureId: "fx_1",
    kind: "switch",
    x: 120,
    y: 80
  });
  assert(invalidSwitch === base, "Switch without wall host should no-op.");

  const nextPlan = planReducer(base, {
    type: "plan/lighting/addFixture",
    fixtureId: "fx_1",
    kind: "switch",
    subtype: "switch_single",
    x: 120,
    y: 80,
    roomId: "room_a",
    host: {
      type: "wallSide",
      rectangleId: "rect_a",
      side: "right",
      offset: 0.5
    }
  });
  assert(nextPlan !== base, "Valid fixture add should produce a new plan object.");
  assertEqual(nextPlan.entities.lighting.fixtures.length, 1);
  assertEqual(nextPlan.entities.lighting.fixtures[0].kind, "switch");
  assertEqual(nextPlan.entities.lighting.fixtures[0].host.type, "wallSide");
});

test("plan reducer lighting move fixture updates geometry and host", () => {
  const base = createEmptyPlan();
  const withFixture = planReducer(base, {
    type: "plan/lighting/addFixture",
    fixtureId: "fx_1",
    kind: "switch",
    x: 100,
    y: 40,
    host: {
      type: "wallSide",
      rectangleId: "rect_a",
      side: "top",
      offset: 0.25
    }
  });

  const moved = planReducer(withFixture, {
    type: "plan/lighting/moveFixture",
    fixtureId: "fx_1",
    x: 140,
    y: 40,
    host: {
      type: "wallSide",
      rectangleId: "rect_a",
      side: "top",
      offset: 0.45
    }
  });
  assert(moved !== withFixture, "moveFixture should produce a new plan object.");
  assertEqual(moved.entities.lighting.fixtures[0].x, 140);
  assertEqual(moved.entities.lighting.fixtures[0].host.offset, 0.45);
});

test("plan reducer lighting link and unlink switch-to-lamp", () => {
  const base = createEmptyPlan();
  const withSwitch = planReducer(base, {
    type: "plan/lighting/addFixture",
    fixtureId: "fx_s1",
    kind: "switch",
    x: 100,
    y: 60,
    host: {
      type: "wallSide",
      rectangleId: "rect_a",
      side: "left",
      offset: 0.2
    }
  });
  const withLamp = planReducer(withSwitch, {
    type: "plan/lighting/addFixture",
    fixtureId: "fx_l1",
    kind: "lamp",
    x: 160,
    y: 120
  });

  const linked = planReducer(withLamp, {
    type: "plan/lighting/linkSwitch",
    switchId: "fx_s1",
    targetType: "lamp",
    targetId: "fx_l1"
  });
  assertEqual(linked.entities.lighting.links.length, 1);
  assertEqual(linked.entities.lighting.links[0].switchId, "fx_s1");
  assertEqual(linked.entities.lighting.links[0].targetId, "fx_l1");

  const unlinked = planReducer(linked, {
    type: "plan/lighting/unlinkSwitchTarget",
    switchId: "fx_s1",
    targetType: "lamp",
    targetId: "fx_l1"
  });
  assertEqual(unlinked.entities.lighting.links.length, 0);
});

test("plan reducer lighting delete fixture prunes dependent links", () => {
  const base = createEmptyPlan();
  const withSwitch = planReducer(base, {
    type: "plan/lighting/addFixture",
    fixtureId: "fx_s1",
    kind: "switch",
    x: 80,
    y: 80,
    host: {
      type: "wallSide",
      rectangleId: "rect_a",
      side: "left",
      offset: 0.4
    }
  });
  const withLamp = planReducer(withSwitch, {
    type: "plan/lighting/addFixture",
    fixtureId: "fx_l1",
    kind: "lamp",
    x: 160,
    y: 120
  });
  const withLink = planReducer(withLamp, {
    type: "plan/lighting/linkSwitch",
    switchId: "fx_s1",
    targetType: "lamp",
    targetId: "fx_l1"
  });

  const deletedLamp = planReducer(withLink, {
    type: "plan/lighting/deleteFixture",
    fixtureId: "fx_l1"
  });
  assertEqual(deletedLamp.entities.lighting.fixtures.length, 1);
  assertEqual(deletedLamp.entities.lighting.links.length, 0);
});

test("plan reducer moving rectangle keeps hosted switches and lamps glued", () => {
  const base = createEmptyPlan();
  const plan = {
    ...base,
    entities: {
      ...base.entities,
      rectangles: [
        {
          id: "rect_a",
          kind: "roomRect",
          x: 100,
          y: 200,
          w: 120,
          h: 80,
          wallCm: { top: 0, right: 0, bottom: 0, left: 0 },
          roomId: "room_a",
          label: null
        }
      ],
      rooms: [
        { id: "room_a", name: "A", roomType: "generic", rectangleIds: ["rect_a"] }
      ],
      lighting: {
        fixtures: [
          {
            id: "fx_s1",
            kind: "switch",
            subtype: "switch_single",
            x: 100,
            y: 240,
            roomId: "room_a",
            host: { type: "wallSide", rectangleId: "rect_a", side: "left", offset: 0.5 },
            meta: { label: null }
          },
          {
            id: "fx_l1",
            kind: "lamp",
            subtype: "led_spot",
            x: 150,
            y: 230,
            roomId: "room_a",
            host: { type: "roomInterior", rectangleId: "rect_a", offsetX: 50, offsetY: 30 },
            meta: { label: null }
          }
        ],
        groups: [],
        links: []
      }
    }
  };

  const moved = planReducer(plan, {
    type: "plan/rectangles/move",
    rectangleId: "rect_a",
    x: 130,
    y: 260
  });
  const movedSwitch = moved.entities.lighting.fixtures.find((fixture) => fixture.id === "fx_s1");
  const movedLamp = moved.entities.lighting.fixtures.find((fixture) => fixture.id === "fx_l1");
  assertEqual(movedSwitch.x, 130);
  assertEqual(movedSwitch.y, 300);
  assertEqual(movedLamp.x, 180);
  assertEqual(movedLamp.y, 290);
});

test("plan reducer creates and deletes lamp groups and linked edges", () => {
  const base = createEmptyPlan();
  const withSwitch = planReducer(base, {
    type: "plan/lighting/addFixture",
    fixtureId: "fx_s1",
    kind: "switch",
    x: 40,
    y: 20,
    host: {
      type: "wallSide",
      rectangleId: "rect_a",
      side: "top",
      offset: 0.2
    }
  });
  const withLampA = planReducer(withSwitch, {
    type: "plan/lighting/addFixture",
    fixtureId: "fx_l1",
    kind: "lamp",
    x: 80,
    y: 80,
    roomId: "room_a"
  });
  const withLampB = planReducer(withLampA, {
    type: "plan/lighting/addFixture",
    fixtureId: "fx_l2",
    kind: "lamp",
    x: 100,
    y: 80,
    roomId: "room_a"
  });

  const grouped = planReducer(withLampB, {
    type: "plan/lighting/createGroupFromLamps",
    groupId: "lg_user_1",
    roomId: "room_a",
    name: "Kitchen Spots",
    fixtureIds: ["fx_l1", "fx_l2"]
  });
  assertEqual(grouped.entities.lighting.groups.length, 1);
  assertEqual(grouped.entities.lighting.groups[0].id, "lg_user_1");

  const linked = planReducer(grouped, {
    type: "plan/lighting/linkSwitch",
    switchId: "fx_s1",
    targetType: "lampGroup",
    targetId: "lg_user_1"
  });
  assertEqual(linked.entities.lighting.links.length, 1);

  const deletedGroup = planReducer(linked, {
    type: "plan/lighting/deleteGroup",
    groupId: "lg_user_1"
  });
  assertEqual(deletedGroup.entities.lighting.groups.length, 0);
  assertEqual(deletedGroup.entities.lighting.links.length, 0);
});
