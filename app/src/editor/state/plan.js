import { deriveTouchingAdjacency, isConnectedSelection } from "../geometry/room-merge.js";

const PLAN_VERSION = 1;
const DEFAULT_ROOM_TYPE = "generic";
const DEFAULT_MERGED_ROOM_NAME = "Merged Room";
const DEFAULT_WALL_HEIGHT_METERS = 2.7;
const ROOM_TYPE_SET = new Set([
  "generic",
  "living_room",
  "bedroom",
  "kitchen",
  "bathroom",
  "toilet",
  "hallway",
  "closet",
  "storage",
  "utility",
  "other"
]);

export function createEmptyPlan() {
  const now = new Date().toISOString();
  return {
    version: PLAN_VERSION,
    planId: "plan_local_001",
    meta: {
      name: "Untitled plan",
      createdAt: now,
      updatedAt: now
    },
    background: {
      sourceType: "sample",
      source: "apartment1.png",
      opacity: 0.35,
      transform: { x: 120, y: 80, width: 980, height: 720 }
    },
    scale: {
      metersPerWorldUnit: null,
      referenceLine: null
    },
    settings: {
      wallHeightMeters: DEFAULT_WALL_HEIGHT_METERS
    },
    entities: {
      rectangles: [],
      openings: [],
      rooms: [],
      lighting: {
        fixtures: [],
        links: []
      }
    }
  };
}

export function planReducer(plan, action) {
  switch (action.type) {
    case "plan/replace":
      return stampPlan(action.plan);

    case "plan/background/setOpacity": {
      const nextOpacity = clampNumber(action.opacity, 0, 1, plan.background.opacity);
      if (nextOpacity === plan.background.opacity) {
        return plan;
      }
      return stampPlan({
        ...plan,
        background: {
          ...plan.background,
          opacity: nextOpacity
        }
      });
    }

    case "plan/background/nudge": {
      const dx = Number.isFinite(action.dx) ? action.dx : 0;
      const dy = Number.isFinite(action.dy) ? action.dy : 0;
      if (dx === 0 && dy === 0) {
        return plan;
      }

      const nextTransform = nudgeBackgroundTransform(plan.background.transform, dx, dy);
      return stampPlan({
        ...plan,
        background: {
          ...plan.background,
          transform: nextTransform
        }
      });
    }

    case "plan/background/scaleUniform": {
      const factor = Number.isFinite(action.factor) ? action.factor : 1;
      if (factor === 1) {
        return plan;
      }

      const nextTransform = scaleBackgroundTransformUniform(plan.background.transform, factor, {
        minWidth: 40,
        minHeight: 40
      });

      if (
        nextTransform.x === plan.background.transform.x &&
        nextTransform.y === plan.background.transform.y &&
        nextTransform.width === plan.background.transform.width &&
        nextTransform.height === plan.background.transform.height
      ) {
        return plan;
      }

      return stampPlan({
        ...plan,
        background: {
          ...plan.background,
          transform: nextTransform
        }
      });
    }

    case "plan/scale/setCalibration": {
      const referenceLine = normalizeScaleReferenceLinePayload(action.referenceLine);
      const metersPerWorldUnit = positiveFiniteNumber(action.metersPerWorldUnit, null);
      if (!referenceLine || metersPerWorldUnit == null) {
        return plan;
      }

      if (hasSameScaleCalibration(plan.scale, referenceLine, metersPerWorldUnit)) {
        return plan;
      }

      return stampPlan({
        ...plan,
        scale: {
          metersPerWorldUnit,
          referenceLine
        }
      });
    }

    case "plan/scale/setMetersPerWorldUnit": {
      const metersPerWorldUnit = positiveFiniteNumber(action.metersPerWorldUnit, null);
      if (metersPerWorldUnit == null) {
        return plan;
      }
      if (plan.scale?.metersPerWorldUnit === metersPerWorldUnit && plan.scale?.referenceLine == null) {
        return plan;
      }
      return stampPlan({
        ...plan,
        scale: {
          metersPerWorldUnit,
          referenceLine: null
        }
      });
    }

    case "plan/settings/setWallHeightMeters": {
      const wallHeightMeters = positiveFiniteNumber(action.wallHeightMeters, null);
      if (wallHeightMeters == null) {
        return plan;
      }
      const previousWallHeight = positiveFiniteNumber(plan?.settings?.wallHeightMeters, DEFAULT_WALL_HEIGHT_METERS);
      if (previousWallHeight === wallHeightMeters) {
        return plan;
      }
      return stampPlan({
        ...plan,
        settings: {
          ...(plan.settings ?? {}),
          wallHeightMeters
        }
      });
    }

    case "plan/rectangles/create": {
      const nextRectangle = action.rectangle ?? createRoomRectangleEntity(action.rectangleId, action.x, action.y, action.w, action.h);
      return stampPlan({
        ...plan,
        entities: {
          ...plan.entities,
          rectangles: [...plan.entities.rectangles, nextRectangle]
        }
      });
    }

    case "plan/rectangles/delete": {
      const rectangleIndex = plan.entities.rectangles.findIndex((rectangle) => rectangle.id === action.rectangleId);
      if (rectangleIndex < 0) {
        return plan;
      }

      const deletedRectangleId = action.rectangleId;
      const nextRectangles = plan.entities.rectangles.filter((rectangle) => rectangle.id !== deletedRectangleId);
      const nextRooms = cleanupRoomsAfterRectangleDelete(plan.entities.rooms, deletedRectangleId);
      const nextOpenings = cleanupOpeningsAfterRectangleDelete(plan.entities.openings, deletedRectangleId);
      const nextLighting = cleanupLightingAfterRectangleDelete(plan.entities.lighting, deletedRectangleId);

      return stampPlan({
        ...plan,
        entities: {
          ...plan.entities,
          rectangles: nextRectangles,
          openings: nextOpenings,
          rooms: nextRooms,
          lighting: nextLighting
        }
      });
    }

    case "plan/rectangles/move": {
      const rectangleIndex = plan.entities.rectangles.findIndex((rectangle) => rectangle.id === action.rectangleId);
      if (rectangleIndex < 0) {
        return plan;
      }

      const current = plan.entities.rectangles[rectangleIndex];
      if (current.x === action.x && current.y === action.y) {
        return plan;
      }

      const nextRectangles = plan.entities.rectangles.slice();
      nextRectangles[rectangleIndex] = {
        ...current,
        x: action.x,
        y: action.y
      };
      const nextOpenings = applyOpeningGeometryAfterRectanglesChanged(
        plan.entities.openings,
        plan.entities.rectangles,
        nextRectangles
      );
      const nextLighting = applyLightingFixtureGeometryAfterRectanglesChanged(
        plan.entities.lighting,
        plan.entities.rectangles,
        nextRectangles
      );

      return stampPlan({
        ...plan,
        entities: {
          ...plan.entities,
          rectangles: nextRectangles,
          openings: nextOpenings,
          lighting: nextLighting
        }
      });
    }

    case "plan/rectangles/setGeometry": {
      const rectangleIndex = plan.entities.rectangles.findIndex((rectangle) => rectangle.id === action.rectangleId);
      if (rectangleIndex < 0) {
        return plan;
      }

      const current = plan.entities.rectangles[rectangleIndex];
      if (
        current.x === action.x &&
        current.y === action.y &&
        current.w === action.w &&
        current.h === action.h
      ) {
        return plan;
      }

      const nextRectangles = plan.entities.rectangles.slice();
      nextRectangles[rectangleIndex] = {
        ...current,
        x: action.x,
        y: action.y,
        w: action.w,
        h: action.h
      };
      const nextOpenings = applyOpeningGeometryAfterRectanglesChanged(
        plan.entities.openings,
        plan.entities.rectangles,
        nextRectangles
      );
      const nextLighting = applyLightingFixtureGeometryAfterRectanglesChanged(
        plan.entities.lighting,
        plan.entities.rectangles,
        nextRectangles
      );

      return stampPlan({
        ...plan,
        entities: {
          ...plan.entities,
          rectangles: nextRectangles,
          openings: nextOpenings,
          lighting: nextLighting
        }
      });
    }

    case "plan/rectangles/setManyGeometry": {
      const rawUpdates = Array.isArray(action.rectangles) ? action.rectangles : [];
      if (rawUpdates.length === 0) {
        return plan;
      }

      const rectangleIndexById = new Map(
        plan.entities.rectangles.map((rectangle, index) => [rectangle.id, index])
      );
      const normalizedUpdates = [];
      for (const update of rawUpdates) {
        const rectangleId = normalizeNonEmptyString(update?.id);
        if (!rectangleId) {
          continue;
        }
        const rectangleIndex = rectangleIndexById.get(rectangleId);
        if (!Number.isInteger(rectangleIndex)) {
          continue;
        }
        if (
          !Number.isFinite(update.x) ||
          !Number.isFinite(update.y) ||
          !Number.isFinite(update.w) ||
          !Number.isFinite(update.h) ||
          update.w <= 0 ||
          update.h <= 0
        ) {
          continue;
        }
        normalizedUpdates.push({
          rectangleIndex,
          rectangleId,
          x: update.x,
          y: update.y,
          w: update.w,
          h: update.h
        });
      }

      if (normalizedUpdates.length === 0) {
        return plan;
      }

      let changed = false;
      const nextRectangles = plan.entities.rectangles.slice();
      for (const update of normalizedUpdates) {
        const current = nextRectangles[update.rectangleIndex];
        if (
          current.x === update.x &&
          current.y === update.y &&
          current.w === update.w &&
          current.h === update.h
        ) {
          continue;
        }
        nextRectangles[update.rectangleIndex] = {
          ...current,
          x: update.x,
          y: update.y,
          w: update.w,
          h: update.h
        };
        changed = true;
      }

      if (!changed) {
        return plan;
      }
      const nextOpenings = applyOpeningGeometryAfterRectanglesChanged(
        plan.entities.openings,
        plan.entities.rectangles,
        nextRectangles
      );
      const nextLighting = applyLightingFixtureGeometryAfterRectanglesChanged(
        plan.entities.lighting,
        plan.entities.rectangles,
        nextRectangles
      );

      return stampPlan({
        ...plan,
        entities: {
          ...plan.entities,
          rectangles: nextRectangles,
          openings: nextOpenings,
          lighting: nextLighting
        }
      });
    }

    case "plan/rectangles/setKind": {
      const rectangleIndex = plan.entities.rectangles.findIndex((rectangle) => rectangle.id === action.rectangleId);
      if (rectangleIndex < 0) {
        return plan;
      }

      const nextKind = normalizeRectangleKind(action.kind);
      if (!nextKind) {
        return plan;
      }

      const current = plan.entities.rectangles[rectangleIndex];
      if (current.kind === nextKind) {
        return plan;
      }

      const nextRectangles = plan.entities.rectangles.slice();
      nextRectangles[rectangleIndex] = {
        ...current,
        kind: nextKind,
        wallCm: nextKind === "wallRect" ? { top: 0, right: 0, bottom: 0, left: 0 } : normalizeWallCm(current.wallCm),
        roomId: nextKind === "wallRect" ? null : current.roomId
      };
      const nextRooms = nextKind === "wallRect"
        ? cleanupRoomsAfterRectangleDelete(plan.entities.rooms, current.id)
        : plan.entities.rooms;

      return stampPlan({
        ...plan,
        entities: {
          ...plan.entities,
          rectangles: nextRectangles,
          rooms: nextRooms
        }
      });
    }

    case "plan/rectangles/setWallCm": {
      const rectangleIndex = plan.entities.rectangles.findIndex((rectangle) => rectangle.id === action.rectangleId);
      if (rectangleIndex < 0) {
        return plan;
      }

      const side = normalizeWallSide(action.side);
      if (!side) {
        return plan;
      }

      const current = plan.entities.rectangles[rectangleIndex];
      const currentWallCm = normalizeWallCm(current.wallCm);
      const nextValue = nonNegativeFiniteNumber(action.value, currentWallCm[side]);
      if (nextValue === currentWallCm[side]) {
        return plan;
      }

      const nextRectangles = plan.entities.rectangles.slice();
      nextRectangles[rectangleIndex] = {
        ...current,
        wallCm: {
          ...currentWallCm,
          [side]: nextValue
        }
      };

      return stampPlan({
        ...plan,
        entities: {
          ...plan.entities,
          rectangles: nextRectangles
        }
      });
    }

    case "plan/rooms/upsertForRectangle": {
      const rectangleIndex = plan.entities.rectangles.findIndex((rectangle) => rectangle.id === action.rectangleId);
      if (rectangleIndex < 0) {
        return plan;
      }

      const rectangle = plan.entities.rectangles[rectangleIndex];
      if (rectangle.kind === "wallRect") {
        return plan;
      }

      const roomName = normalizeRoomName(action.name);
      if (!roomName) {
        return plan;
      }

      const requestedRoomId = normalizeNonEmptyString(action.roomId);
      const fallbackRoomId = normalizeNonEmptyString(rectangle.roomId);
      const requestedRoomType = normalizeRoomType(action.roomType);
      const detachedRooms = detachRectangleFromRooms(plan.entities.rooms, rectangle.id);
      const targetRoomId = requestedRoomId ?? fallbackRoomId;

      let nextRooms = detachedRooms;
      let targetRoom = targetRoomId ? nextRooms.find((room) => room.id === targetRoomId) ?? null : null;

      if (!targetRoom) {
        const generatedId = targetRoomId ?? generateRoomId(nextRooms, roomName);
        targetRoom = {
          id: generatedId,
          name: roomName,
          roomType: requestedRoomType,
          rectangleIds: []
        };
        nextRooms = [...nextRooms, targetRoom];
      }

      const nextRectangles = plan.entities.rectangles.slice();
      nextRectangles[rectangleIndex] = {
        ...rectangle,
        roomId: targetRoom.id
      };

      const nextRoomsWithAssignment = nextRooms.map((room) => {
        if (room.id !== targetRoom.id) {
          return room;
        }
        const rectangleIds = room.rectangleIds.includes(rectangle.id)
          ? room.rectangleIds
          : [...room.rectangleIds, rectangle.id];
        return {
          ...room,
          name: roomName,
          roomType: requestedRoomType,
          rectangleIds
        };
      });

      return stampPlan({
        ...plan,
        entities: {
          ...plan.entities,
          rectangles: nextRectangles,
          rooms: nextRoomsWithAssignment
        }
      });
    }

    case "plan/rooms/clearForRectangle": {
      const rectangleIndex = plan.entities.rectangles.findIndex((rectangle) => rectangle.id === action.rectangleId);
      if (rectangleIndex < 0) {
        return plan;
      }

      const rectangle = plan.entities.rectangles[rectangleIndex];
      if (!rectangle.roomId) {
        return plan;
      }

      const nextRectangles = plan.entities.rectangles.slice();
      nextRectangles[rectangleIndex] = {
        ...rectangle,
        roomId: null
      };
      const nextRooms = detachRectangleFromRooms(plan.entities.rooms, rectangle.id);

      return stampPlan({
        ...plan,
        entities: {
          ...plan.entities,
          rectangles: nextRectangles,
          rooms: nextRooms
        }
      });
    }

    case "plan/rooms/mergeRectangles": {
      const requestedRoomName = normalizeRoomName(action.name);

      const selectedRectangleIds = Array.from(
        new Set(
          Array.isArray(action.rectangleIds)
            ? action.rectangleIds.filter((rectangleId) => typeof rectangleId === "string" && rectangleId)
            : []
        )
      );
      if (selectedRectangleIds.length < 2) {
        return plan;
      }

      const rectangleById = new Map(plan.entities.rectangles.map((rectangle) => [rectangle.id, rectangle]));
      const selectedRectangles = [];
      for (const rectangleId of selectedRectangleIds) {
        const rectangle = rectangleById.get(rectangleId);
        if (!rectangle || rectangle.kind === "wallRect") {
          return plan;
        }
        selectedRectangles.push(rectangle);
      }

      const adjacency = deriveTouchingAdjacency(plan.entities.rectangles, {
        metersPerWorldUnit: plan.scale?.metersPerWorldUnit
      });
      if (!isConnectedSelection(selectedRectangleIds, adjacency)) {
        return plan;
      }

      const requestedRoomTypeRaw = normalizeNonEmptyString(action.roomType);
      const requestedRoomType = requestedRoomTypeRaw ? normalizeRoomType(requestedRoomTypeRaw) : null;
      const selectedRectangleIdSet = new Set(selectedRectangleIds);
      const sharedExistingRoomId = resolveSharedExistingRoomId(selectedRectangles);
      let nextRooms = detachRectanglesFromRooms(plan.entities.rooms, selectedRectangleIdSet);
      let targetRoom = sharedExistingRoomId
        ? nextRooms.find((room) => room.id === sharedExistingRoomId) ?? null
        : null;

      if (!targetRoom) {
        const generatedId = sharedExistingRoomId ?? generateRoomId(nextRooms, requestedRoomName ?? DEFAULT_MERGED_ROOM_NAME);
        targetRoom = {
          id: generatedId,
          name: requestedRoomName ?? DEFAULT_MERGED_ROOM_NAME,
          roomType: requestedRoomType ?? DEFAULT_ROOM_TYPE,
          rectangleIds: []
        };
        nextRooms = [...nextRooms, targetRoom];
      }
      const roomName = resolveMergeRoomName(requestedRoomName, targetRoom?.name);

      const nextRectangles = plan.entities.rectangles.map((rectangle) => (
        selectedRectangleIdSet.has(rectangle.id)
          ? { ...rectangle, roomId: targetRoom.id }
          : rectangle
      ));

      const nextRoomsWithAssignment = nextRooms.map((room) => {
        if (room.id !== targetRoom.id) {
          return room;
        }
        const rectangleIds = Array.from(
          new Set([...(Array.isArray(room.rectangleIds) ? room.rectangleIds : []), ...selectedRectangleIds])
        );
        return {
          ...room,
          name: roomName,
          roomType: requestedRoomType ?? normalizeRoomType(room.roomType),
          rectangleIds
        };
      });

      return stampPlan({
        ...plan,
        entities: {
          ...plan.entities,
          rectangles: nextRectangles,
          rooms: nextRoomsWithAssignment
        }
      });
    }

    case "plan/rooms/dissolveRoom": {
      const roomId = normalizeNonEmptyString(action.roomId);
      if (!roomId) {
        return plan;
      }

      const room = Array.isArray(plan.entities.rooms)
        ? plan.entities.rooms.find((candidate) => candidate?.id === roomId) ?? null
        : null;
      if (!room) {
        return plan;
      }

      const nextRectangles = plan.entities.rectangles.map((rectangle) => (
        rectangle.roomId === roomId
          ? { ...rectangle, roomId: null }
          : rectangle
      ));
      const nextRooms = plan.entities.rooms.filter((candidate) => candidate?.id !== roomId);
      const nextLighting = clearLightingRoomAssignment(plan.entities.lighting, roomId);

      return stampPlan({
        ...plan,
        entities: {
          ...plan.entities,
          rectangles: nextRectangles,
          rooms: nextRooms,
          lighting: nextLighting
        }
      });
    }

    case "plan/openings/add": {
      const openingId = normalizeNonEmptyString(action.openingId);
      const kind = normalizeOpeningKind(action.kind);
      const host = normalizeOpeningHost(action.host);
      const widthWorld = positiveFiniteNumber(action.widthWorld, null);
      if (!openingId || !kind || !host || widthWorld == null) {
        return plan;
      }

      const openings = ensureOpeningCollection(plan.entities.openings);
      if (openings.some((opening) => opening?.id === openingId)) {
        return plan;
      }

      const rectangle = plan.entities.rectangles.find((candidate) => candidate?.id === host.rectangleId) ?? null;
      if (!rectangle || !isOpeningHostWallCapable(rectangle, host.side)) {
        return plan;
      }

      const placement = projectOpeningGeometryFromHost(rectangle, host, widthWorld);
      if (!placement) {
        return plan;
      }

      return stampPlan({
        ...plan,
        entities: {
          ...plan.entities,
          openings: [
            ...openings,
            {
              id: openingId,
              kind,
              host: placement.host,
              widthWorld: placement.widthWorld,
              x: placement.x,
              y: placement.y
            }
          ]
        }
      });
    }

    case "plan/openings/move": {
      const openingId = normalizeNonEmptyString(action.openingId);
      const host = normalizeOpeningHost(action.host);
      if (!openingId || !host) {
        return plan;
      }

      const openings = ensureOpeningCollection(plan.entities.openings);
      const openingIndex = openings.findIndex((opening) => opening?.id === openingId);
      if (openingIndex < 0) {
        return plan;
      }

      const current = openings[openingIndex];
      const rectangle = plan.entities.rectangles.find((candidate) => candidate?.id === host.rectangleId) ?? null;
      if (!rectangle || !isOpeningHostWallCapable(rectangle, host.side)) {
        return plan;
      }
      const placement = projectOpeningGeometryFromHost(rectangle, host, current.widthWorld);
      if (!placement) {
        return plan;
      }

      if (
        current.x === placement.x &&
        current.y === placement.y &&
        current.widthWorld === placement.widthWorld &&
        areOpeningHostsEqual(current.host, placement.host)
      ) {
        return plan;
      }

      const nextOpenings = openings.slice();
      nextOpenings[openingIndex] = {
        ...current,
        host: placement.host,
        widthWorld: placement.widthWorld,
        x: placement.x,
        y: placement.y
      };

      return stampPlan({
        ...plan,
        entities: {
          ...plan.entities,
          openings: nextOpenings
        }
      });
    }

    case "plan/openings/resize": {
      const openingId = normalizeNonEmptyString(action.openingId);
      const widthWorld = positiveFiniteNumber(action.widthWorld, null);
      if (!openingId || widthWorld == null) {
        return plan;
      }

      const openings = ensureOpeningCollection(plan.entities.openings);
      const openingIndex = openings.findIndex((opening) => opening?.id === openingId);
      if (openingIndex < 0) {
        return plan;
      }

      const current = openings[openingIndex];
      const host = normalizeOpeningHost(current.host);
      if (!host) {
        return plan;
      }
      const rectangle = plan.entities.rectangles.find((candidate) => candidate?.id === host.rectangleId) ?? null;
      if (!rectangle || !isOpeningHostWallCapable(rectangle, host.side)) {
        return plan;
      }
      const placement = projectOpeningGeometryFromHost(rectangle, host, widthWorld);
      if (!placement) {
        return plan;
      }

      if (
        current.x === placement.x &&
        current.y === placement.y &&
        current.widthWorld === placement.widthWorld &&
        areOpeningHostsEqual(current.host, placement.host)
      ) {
        return plan;
      }

      const nextOpenings = openings.slice();
      nextOpenings[openingIndex] = {
        ...current,
        host: placement.host,
        widthWorld: placement.widthWorld,
        x: placement.x,
        y: placement.y
      };

      return stampPlan({
        ...plan,
        entities: {
          ...plan.entities,
          openings: nextOpenings
        }
      });
    }

    case "plan/openings/delete": {
      const openingId = normalizeNonEmptyString(action.openingId);
      if (!openingId) {
        return plan;
      }
      const openings = ensureOpeningCollection(plan.entities.openings);
      const nextOpenings = openings.filter((opening) => opening?.id !== openingId);
      if (nextOpenings.length === openings.length) {
        return plan;
      }

      return stampPlan({
        ...plan,
        entities: {
          ...plan.entities,
          openings: nextOpenings
        }
      });
    }

    case "plan/lighting/addFixture": {
      const fixtureId = normalizeNonEmptyString(action.fixtureId);
      const fixtureKind = normalizeLightingFixtureKind(action.kind);
      const x = finiteNumberOrNull(action.x);
      const y = finiteNumberOrNull(action.y);
      if (!fixtureId || !fixtureKind || x == null || y == null) {
        return plan;
      }

      const lighting = ensureLightingCollections(plan.entities.lighting);
      const fixtureExists = lighting.fixtures.some((fixture) => fixture?.id === fixtureId);
      if (fixtureExists) {
        return plan;
      }

      const subtype = normalizeLightingFixtureSubtype(action.subtype, fixtureKind);
      const roomId = normalizeNonEmptyString(action.roomId);
      const host = normalizeLightingFixtureHost(action.host, fixtureKind);
      const label = normalizeLightingFixtureLabel(action.label);

      const nextFixture = {
        id: fixtureId,
        kind: fixtureKind,
        subtype,
        x,
        y,
        roomId: roomId ?? null,
        host,
        meta: {
          label
        }
      };

      return stampPlan({
        ...plan,
        entities: {
          ...plan.entities,
          lighting: {
            ...lighting,
            fixtures: [...lighting.fixtures, nextFixture]
          }
        }
      });
    }

    case "plan/lighting/moveFixture": {
      const fixtureId = normalizeNonEmptyString(action.fixtureId);
      if (!fixtureId) {
        return plan;
      }

      const lighting = ensureLightingCollections(plan.entities.lighting);
      const fixtureIndex = lighting.fixtures.findIndex((fixture) => fixture?.id === fixtureId);
      if (fixtureIndex < 0) {
        return plan;
      }

      const current = lighting.fixtures[fixtureIndex];
      const x = finiteNumberOrNull(action.x);
      const y = finiteNumberOrNull(action.y);
      if (x == null || y == null) {
        return plan;
      }

      const roomId = action.roomId === undefined
        ? current.roomId ?? null
        : normalizeNonEmptyString(action.roomId);
      const host = action.host === undefined
        ? current.host
        : normalizeLightingFixtureHost(action.host, current.kind);
      if (!host) {
        return plan;
      }

      if (
        current.x === x &&
        current.y === y &&
        (current.roomId ?? null) === (roomId ?? null) &&
        areLightingHostsEqual(current.host, host)
      ) {
        return plan;
      }

      const nextFixtures = lighting.fixtures.slice();
      nextFixtures[fixtureIndex] = {
        ...current,
        x,
        y,
        roomId: roomId ?? null,
        host
      };

      return stampPlan({
        ...plan,
        entities: {
          ...plan.entities,
          lighting: {
            ...lighting,
            fixtures: nextFixtures
          }
        }
      });
    }

    case "plan/lighting/deleteFixture": {
      const fixtureId = normalizeNonEmptyString(action.fixtureId);
      if (!fixtureId) {
        return plan;
      }

      const lighting = ensureLightingCollections(plan.entities.lighting);
      const fixtureExists = lighting.fixtures.some((fixture) => fixture?.id === fixtureId);
      if (!fixtureExists) {
        return plan;
      }

      const nextLighting = cleanupLightingAfterFixtureDelete(lighting, fixtureId);
      return stampPlan({
        ...plan,
        entities: {
          ...plan.entities,
          lighting: nextLighting
        }
      });
    }

    case "plan/lighting/linkSwitch": {
      const switchId = normalizeNonEmptyString(action.switchId);
      const targetType = normalizeLightingLinkTargetType(action.targetType);
      const targetId = normalizeNonEmptyString(action.targetId);
      if (!switchId || !targetType || !targetId) {
        return plan;
      }

      const lighting = ensureLightingCollections(plan.entities.lighting);
      if (!hasLightingFixture(lighting.fixtures, switchId, "switch")) {
        return plan;
      }

      const targetExists = hasLightingFixture(lighting.fixtures, targetId, "lamp");
      if (!targetExists) {
        return plan;
      }

      const duplicate = lighting.links.some((link) => (
        link?.switchId === switchId &&
        link?.targetType === targetType &&
        link?.targetId === targetId
      ));
      if (duplicate) {
        return plan;
      }

      const linkId = normalizeNonEmptyString(action.linkId) ?? generateLightingLinkId(lighting.links);
      const nextLink = {
        id: linkId,
        switchId,
        targetType,
        targetId
      };

      return stampPlan({
        ...plan,
        entities: {
          ...plan.entities,
          lighting: {
            ...lighting,
            links: [...lighting.links, nextLink]
          }
        }
      });
    }

    case "plan/lighting/unlinkSwitchTarget": {
      const switchId = normalizeNonEmptyString(action.switchId);
      const targetType = normalizeLightingLinkTargetType(action.targetType);
      const targetId = normalizeNonEmptyString(action.targetId);
      if (!switchId || !targetType || !targetId) {
        return plan;
      }

      const lighting = ensureLightingCollections(plan.entities.lighting);
      const nextLinks = lighting.links.filter((link) => !(
        link?.switchId === switchId &&
        link?.targetType === targetType &&
        link?.targetId === targetId
      ));
      if (nextLinks.length === lighting.links.length) {
        return plan;
      }

      return stampPlan({
        ...plan,
        entities: {
          ...plan.entities,
          lighting: {
            ...lighting,
            links: nextLinks
          }
        }
      });
    }

    case "plan/debugSeedRectangles": {
      if (plan.entities.rectangles.length > 0 && !action.force) {
        return plan;
      }

      const nextRectangles = [
        {
          id: "rect_room_debug_1",
          kind: "roomRect",
          x: 120,
          y: 120,
          w: 180,
          h: 120,
          wallCm: { top: 10, right: 10, bottom: 10, left: 10 },
          roomId: "room_debug_living",
          label: "Living"
        },
        {
          id: "rect_room_debug_2",
          kind: "roomRect",
          x: 320,
          y: 130,
          w: 110,
          h: 90,
          wallCm: { top: 8, right: 8, bottom: 8, left: 8 },
          roomId: "room_debug_bedroom",
          label: "Bedroom"
        }
      ];

      const nextRooms = [
        {
          id: "room_debug_living",
          name: "Living Room",
          roomType: "living_room",
          rectangleIds: ["rect_room_debug_1"]
        },
        {
          id: "room_debug_bedroom",
          name: "Bedroom",
          roomType: "bedroom",
          rectangleIds: ["rect_room_debug_2"]
        }
      ];

      return stampPlan({
        ...plan,
        entities: {
          ...plan.entities,
          rectangles: nextRectangles,
          rooms: nextRooms
        }
      });
    }

    default:
      return plan;
  }
}

function stampPlan(plan) {
  return {
    ...plan,
    meta: {
      ...plan.meta,
      updatedAt: new Date().toISOString()
    }
  };
}

function createRoomRectangleEntity(id, x, y, w, h) {
  return {
    id,
    kind: "roomRect",
    x,
    y,
    w,
    h,
    wallCm: { top: 0, right: 0, bottom: 0, left: 0 },
    roomId: null,
    label: null
  };
}

function nudgeBackgroundTransform(transform, dx, dy) {
  return {
    ...transform,
    x: transform.x + dx,
    y: transform.y + dy
  };
}

function scaleBackgroundTransformUniform(transform, factor, options = {}) {
  const minWidth = options.minWidth ?? 1;
  const minHeight = options.minHeight ?? 1;
  const centerX = transform.x + transform.width / 2;
  const centerY = transform.y + transform.height / 2;

  const nextWidth = Math.max(minWidth, transform.width * factor);
  const nextHeight = Math.max(minHeight, transform.height * factor);

  return {
    ...transform,
    x: centerX - nextWidth / 2,
    y: centerY - nextHeight / 2,
    width: nextWidth,
    height: nextHeight
  };
}

function clampNumber(value, min, max, fallback) {
  if (!Number.isFinite(value)) {
    return fallback;
  }
  return Math.min(max, Math.max(min, value));
}

function cleanupRoomsAfterRectangleDelete(rooms, deletedRectangleId) {
  return detachRectangleFromRooms(rooms, deletedRectangleId);
}

function detachRectangleFromRooms(rooms, rectangleId) {
  if (!Array.isArray(rooms) || rooms.length === 0) {
    return [];
  }

  const nextRooms = [];
  for (const room of rooms) {
    if (!room || typeof room !== "object") {
      continue;
    }
    const rectangleIds = Array.isArray(room.rectangleIds)
      ? room.rectangleIds.filter((roomRectangleId) => roomRectangleId !== rectangleId)
      : [];

    if (rectangleIds.length === 0) {
      continue;
    }

    nextRooms.push({
      ...room,
      rectangleIds
    });
  }

  return nextRooms;
}

function detachRectanglesFromRooms(rooms, rectangleIdSet) {
  if (!Array.isArray(rooms) || rooms.length === 0) {
    return [];
  }

  const nextRooms = [];
  for (const room of rooms) {
    if (!room || typeof room !== "object") {
      continue;
    }
    const rectangleIds = Array.isArray(room.rectangleIds)
      ? room.rectangleIds.filter((roomRectangleId) => !rectangleIdSet.has(roomRectangleId))
      : [];
    if (rectangleIds.length === 0) {
      continue;
    }
    nextRooms.push({
      ...room,
      rectangleIds
    });
  }
  return nextRooms;
}

function generateRoomId(rooms, roomName) {
  const baseId = roomName
    .trim()
    .toLowerCase()
    .replaceAll(/[^a-z0-9]+/g, "_")
    .replaceAll(/_+/g, "_")
    .replace(/^_+|_+$/g, "");
  const seed = baseId ? `room_${baseId}` : "room";
  const existing = new Set(
    Array.isArray(rooms)
      ? rooms
        .filter((room) => room && typeof room.id === "string")
        .map((room) => room.id)
      : []
  );
  if (!existing.has(seed)) {
    return seed;
  }
  let suffix = 2;
  while (existing.has(`${seed}_${suffix}`)) {
    suffix += 1;
  }
  return `${seed}_${suffix}`;
}

function cleanupOpeningsAfterRectangleDelete(openings, deletedRectangleId) {
  if (!Array.isArray(openings) || openings.length === 0) {
    return [];
  }

  return openings.filter((opening) => {
    if (!opening || typeof opening !== "object") {
      return false;
    }
    const host = opening.host;
    if (!host || typeof host !== "object") {
      return false;
    }
    return host.rectangleId !== deletedRectangleId;
  });
}

function ensureOpeningCollection(rawOpenings) {
  if (!Array.isArray(rawOpenings)) {
    return [];
  }
  return rawOpenings.filter((opening) => opening && typeof opening === "object");
}

function applyOpeningGeometryAfterRectanglesChanged(rawOpenings, previousRectangles, nextRectangles) {
  const openings = ensureOpeningCollection(rawOpenings);
  if (openings.length === 0) {
    return openings;
  }

  const previousById = new Map(
    Array.isArray(previousRectangles)
      ? previousRectangles
        .filter((rectangle) => rectangle && typeof rectangle.id === "string" && rectangle.id)
        .map((rectangle) => [rectangle.id, rectangle])
      : []
  );
  const nextById = new Map(
    Array.isArray(nextRectangles)
      ? nextRectangles
        .filter((rectangle) => rectangle && typeof rectangle.id === "string" && rectangle.id)
        .map((rectangle) => [rectangle.id, rectangle])
      : []
  );

  let changed = false;
  const nextOpenings = openings.map((opening) => {
    const host = normalizeOpeningHost(opening?.host);
    if (!host) {
      return opening;
    }
    const previousRectangle = previousById.get(host.rectangleId);
    const nextRectangle = nextById.get(host.rectangleId);
    if (!previousRectangle || !nextRectangle || !hasRectangleGeometryChanged(previousRectangle, nextRectangle)) {
      return opening;
    }
    if (!isOpeningHostWallCapable(nextRectangle, host.side)) {
      return opening;
    }
    const placement = projectOpeningGeometryFromHost(nextRectangle, host, opening.widthWorld);
    if (!placement) {
      return opening;
    }
    if (
      opening.x === placement.x &&
      opening.y === placement.y &&
      opening.widthWorld === placement.widthWorld &&
      areOpeningHostsEqual(opening.host, placement.host)
    ) {
      return opening;
    }
    changed = true;
    return {
      ...opening,
      host: placement.host,
      widthWorld: placement.widthWorld,
      x: placement.x,
      y: placement.y
    };
  });

  return changed ? nextOpenings : openings;
}

function applyLightingFixtureGeometryAfterRectanglesChanged(rawLighting, previousRectangles, nextRectangles) {
  const lighting = ensureLightingCollections(rawLighting);
  if (lighting.fixtures.length === 0) {
    return lighting;
  }

  const previousById = new Map(
    Array.isArray(previousRectangles)
      ? previousRectangles
        .filter((rectangle) => rectangle && typeof rectangle.id === "string" && rectangle.id)
        .map((rectangle) => [rectangle.id, rectangle])
      : []
  );
  const nextById = new Map(
    Array.isArray(nextRectangles)
      ? nextRectangles
        .filter((rectangle) => rectangle && typeof rectangle.id === "string" && rectangle.id)
        .map((rectangle) => [rectangle.id, rectangle])
      : []
  );

  let changed = false;
  const nextFixtures = lighting.fixtures.map((fixture) => {
    const host = fixture?.host;
    if (!host || typeof host !== "object") {
      return fixture;
    }

    if (fixture.kind === "switch" && host.type === "wallSide") {
      const rectangleId = normalizeNonEmptyString(host.rectangleId);
      if (!rectangleId) {
        return fixture;
      }
      const previousRectangle = previousById.get(rectangleId);
      const nextRectangle = nextById.get(rectangleId);
      if (!previousRectangle || !nextRectangle || !hasRectangleGeometryChanged(previousRectangle, nextRectangle)) {
        return fixture;
      }

      const position = projectFixtureToWallSide(nextRectangle, host.side, host.offset);
      if (!position) {
        return fixture;
      }

      const nextRoomId = normalizeNonEmptyString(fixture.roomId) ?? normalizeNonEmptyString(nextRectangle.roomId) ?? null;
      if (fixture.x === position.x && fixture.y === position.y && (fixture.roomId ?? null) === (nextRoomId ?? null)) {
        return fixture;
      }

      changed = true;
      return {
        ...fixture,
        x: position.x,
        y: position.y,
        roomId: nextRoomId
      };
    }

    if (fixture.kind === "lamp" && host.type === "roomInterior") {
      const rectangleId = normalizeNonEmptyString(host.rectangleId);
      if (!rectangleId) {
        return fixture;
      }
      const previousRectangle = previousById.get(rectangleId);
      const nextRectangle = nextById.get(rectangleId);
      if (!previousRectangle || !nextRectangle || !hasRectangleGeometryChanged(previousRectangle, nextRectangle)) {
        return fixture;
      }

      const offsetX = Number.isFinite(host.offsetX) ? host.offsetX : fixture.x - previousRectangle.x;
      const offsetY = Number.isFinite(host.offsetY) ? host.offsetY : fixture.y - previousRectangle.y;
      const nextX = nextRectangle.x + offsetX;
      const nextY = nextRectangle.y + offsetY;
      const nextRoomId = normalizeNonEmptyString(fixture.roomId) ?? normalizeNonEmptyString(nextRectangle.roomId) ?? null;
      if (
        fixture.x === nextX &&
        fixture.y === nextY &&
        (fixture.roomId ?? null) === (nextRoomId ?? null) &&
        host.offsetX === offsetX &&
        host.offsetY === offsetY
      ) {
        return fixture;
      }

      changed = true;
      return {
        ...fixture,
        x: nextX,
        y: nextY,
        roomId: nextRoomId,
        host: {
          ...host,
          rectangleId,
          offsetX,
          offsetY
        }
      };
    }

    return fixture;
  });

  if (!changed) {
    return lighting;
  }

  return {
    ...lighting,
    fixtures: nextFixtures
  };
}

function hasRectangleGeometryChanged(previousRectangle, nextRectangle) {
  return (
    previousRectangle.x !== nextRectangle.x ||
    previousRectangle.y !== nextRectangle.y ||
    previousRectangle.w !== nextRectangle.w ||
    previousRectangle.h !== nextRectangle.h
  );
}

function projectFixtureToWallSide(rectangle, side, rawOffset) {
  if (
    !rectangle ||
    !Number.isFinite(rectangle.x) ||
    !Number.isFinite(rectangle.y) ||
    !Number.isFinite(rectangle.w) ||
    !Number.isFinite(rectangle.h) ||
    rectangle.w <= 0 ||
    rectangle.h <= 0
  ) {
    return null;
  }
  const offset = clampNumber(rawOffset, 0, 1, null);
  if (offset == null) {
    return null;
  }

  if (side === "top" || side === "bottom") {
    return {
      x: rectangle.x + rectangle.w * offset,
      y: side === "top" ? rectangle.y : rectangle.y + rectangle.h
    };
  }
  if (side === "left" || side === "right") {
    return {
      x: side === "left" ? rectangle.x : rectangle.x + rectangle.w,
      y: rectangle.y + rectangle.h * offset
    };
  }
  return null;
}

function ensureLightingCollections(rawLighting) {
  const lighting = rawLighting && typeof rawLighting === "object" ? rawLighting : {};
  return {
    fixtures: Array.isArray(lighting.fixtures) ? lighting.fixtures.filter((fixture) => fixture && typeof fixture === "object") : [],
    links: Array.isArray(lighting.links) ? lighting.links.filter((link) => link && typeof link === "object") : []
  };
}

function cleanupLightingAfterRectangleDelete(rawLighting, deletedRectangleId) {
  const lighting = ensureLightingCollections(rawLighting);
  if (!deletedRectangleId) {
    return lighting;
  }

  const removedFixtureIds = new Set(
    lighting.fixtures
      .filter((fixture) => (
        typeof fixture?.host?.rectangleId === "string" &&
        fixture.host.rectangleId === deletedRectangleId
      ))
      .map((fixture) => fixture.id)
      .filter((fixtureId) => typeof fixtureId === "string" && fixtureId)
  );

  if (removedFixtureIds.size === 0) {
    return lighting;
  }

  return cleanupLightingAfterFixtureDeletes(lighting, removedFixtureIds);
}

function clearLightingRoomAssignment(rawLighting, roomId) {
  const lighting = ensureLightingCollections(rawLighting);
  if (!roomId) {
    return lighting;
  }

  let changed = false;
  const nextFixtures = lighting.fixtures.map((fixture) => {
    if (fixture?.roomId !== roomId) {
      return fixture;
    }
    changed = true;
    return {
      ...fixture,
      roomId: null
    };
  });

  if (!changed) {
    return lighting;
  }

  return {
    ...lighting,
    fixtures: nextFixtures,
    links: lighting.links
  };
}

function cleanupLightingAfterFixtureDelete(rawLighting, fixtureId) {
  return cleanupLightingAfterFixtureDeletes(rawLighting, new Set([fixtureId]));
}

function cleanupLightingAfterFixtureDeletes(rawLighting, fixtureIds) {
  const lighting = ensureLightingCollections(rawLighting);
  const fixtureIdSet = fixtureIds instanceof Set ? fixtureIds : new Set();
  if (fixtureIdSet.size === 0) {
    return lighting;
  }

  const nextFixtures = lighting.fixtures.filter((fixture) => !fixtureIdSet.has(fixture?.id));

  const nextLinks = lighting.links.filter((link) => (
    !fixtureIdSet.has(link?.switchId) &&
    !(link?.targetType === "lamp" && fixtureIdSet.has(link?.targetId))
  ));

  return {
    ...lighting,
    fixtures: nextFixtures,
    links: nextLinks
  };
}

function normalizeLightingFixtureKind(kind) {
  if (kind === "switch" || kind === "lamp") {
    return kind;
  }
  return null;
}

function normalizeOpeningKind(kind) {
  return kind === "door" || kind === "window" ? kind : null;
}

function normalizeOpeningHost(host) {
  const rawHost = host && typeof host === "object" ? host : null;
  if (!rawHost || rawHost.type !== "wallSide") {
    return null;
  }
  const rectangleId = normalizeNonEmptyString(rawHost.rectangleId);
  const side = normalizeWallSide(rawHost.side ?? rawHost.edge);
  const offset = clampNumber(rawHost.offset, 0, 1, null);
  if (!rectangleId || !side || offset == null) {
    return null;
  }
  return {
    type: "wallSide",
    rectangleId,
    side,
    offset
  };
}

function areOpeningHostsEqual(a, b) {
  const left = normalizeOpeningHost(a);
  const right = normalizeOpeningHost(b);
  if (!left || !right) {
    return false;
  }
  return (
    left.rectangleId === right.rectangleId &&
    left.side === right.side &&
    left.offset === right.offset
  );
}

function isOpeningHostWallCapable(rectangle, side) {
  if (!rectangle || (side !== "top" && side !== "right" && side !== "bottom" && side !== "left")) {
    return false;
  }
  if (rectangle.kind === "wallRect") {
    return true;
  }
  const wallCm = normalizeWallCm(rectangle.wallCm);
  return wallCm[side] > 0;
}

function projectOpeningGeometryFromHost(rectangle, host, rawWidthWorld) {
  if (
    !rectangle ||
    !Number.isFinite(rectangle.x) ||
    !Number.isFinite(rectangle.y) ||
    !Number.isFinite(rectangle.w) ||
    !Number.isFinite(rectangle.h) ||
    rectangle.w <= 0 ||
    rectangle.h <= 0
  ) {
    return null;
  }
  const normalizedHost = normalizeOpeningHost(host);
  if (!normalizedHost) {
    return null;
  }

  const alongLength = (normalizedHost.side === "top" || normalizedHost.side === "bottom")
    ? rectangle.w
    : rectangle.h;
  if (!Number.isFinite(alongLength) || alongLength <= 0) {
    return null;
  }

  const minWidthWorld = Math.max(1, Math.min(40, alongLength));
  const widthWorld = clampNumber(rawWidthWorld, minWidthWorld, alongLength, null);
  if (widthWorld == null) {
    return null;
  }
  const halfWidth = widthWorld / 2;
  const centerAlong = clampNumber(
    normalizedHost.offset * alongLength,
    halfWidth,
    alongLength - halfWidth,
    alongLength / 2
  );
  const offset = alongLength > 0 ? centerAlong / alongLength : 0.5;

  let x = rectangle.x;
  let y = rectangle.y;
  if (normalizedHost.side === "top" || normalizedHost.side === "bottom") {
    x = rectangle.x + centerAlong;
    y = normalizedHost.side === "top"
      ? rectangle.y
      : rectangle.y + rectangle.h;
  } else {
    x = normalizedHost.side === "left"
      ? rectangle.x
      : rectangle.x + rectangle.w;
    y = rectangle.y + centerAlong;
  }

  return {
    host: {
      ...normalizedHost,
      offset
    },
    x,
    y,
    widthWorld
  };
}

function normalizeLightingFixtureSubtype(subtype, fixtureKind) {
  if (typeof subtype === "string" && subtype.trim()) {
    return subtype.trim();
  }
  return fixtureKind === "switch" ? "switch_single" : "led_spot";
}

function normalizeLightingFixtureLabel(label) {
  if (typeof label !== "string") {
    return null;
  }
  const normalized = label.trim();
  return normalized ? normalized : null;
}

function normalizeLightingFixtureHost(host, fixtureKind) {
  if (fixtureKind === "switch") {
    return normalizeSwitchHost(host);
  }
  const rawHost = host && typeof host === "object" ? host : null;
  if (!rawHost || rawHost.type !== "roomInterior") {
    return {
      type: "roomInterior",
      rectangleId: null,
      offsetX: null,
      offsetY: null
    };
  }
  const rectangleId = normalizeNonEmptyString(rawHost.rectangleId);
  const offsetX = Number.isFinite(rawHost.offsetX) ? rawHost.offsetX : null;
  const offsetY = Number.isFinite(rawHost.offsetY) ? rawHost.offsetY : null;
  return {
    type: "roomInterior",
    rectangleId: rectangleId ?? null,
    offsetX,
    offsetY
  };
}

function normalizeSwitchHost(host) {
  const rawHost = host && typeof host === "object" ? host : null;
  if (!rawHost || rawHost.type !== "wallSide") {
    return null;
  }

  const rectangleId = normalizeNonEmptyString(rawHost.rectangleId);
  const side = normalizeWallSide(rawHost.side);
  const offset = clampNumber(rawHost.offset, 0, 1, null);
  if (!rectangleId || !side || offset == null) {
    return null;
  }

  return {
    type: "wallSide",
    rectangleId,
    side,
    offset
  };
}

function areLightingHostsEqual(a, b) {
  if (!a || !b || a.type !== b.type) {
    return false;
  }
  if (a.type === "wallSide") {
    return (
      a.rectangleId === b.rectangleId &&
      a.side === b.side &&
      a.offset === b.offset
    );
  }
  if (a.type === "roomInterior") {
    return (
      (a.rectangleId ?? null) === (b.rectangleId ?? null) &&
      (a.offsetX ?? null) === (b.offsetX ?? null) &&
      (a.offsetY ?? null) === (b.offsetY ?? null)
    );
  }
  return true;
}

function normalizeLightingLinkTargetType(value) {
  if (value === "lamp") {
    return value;
  }
  return null;
}

function hasLightingFixture(fixtures, fixtureId, kind = null) {
  if (!Array.isArray(fixtures)) {
    return false;
  }
  return fixtures.some((fixture) => (
    fixture?.id === fixtureId &&
    (kind == null || fixture?.kind === kind)
  ));
}

function generateLightingLinkId(links) {
  const existing = new Set(
    Array.isArray(links)
      ? links
        .filter((link) => typeof link?.id === "string" && link.id)
        .map((link) => link.id)
      : []
  );
  if (!existing.has("lk_1")) {
    return "lk_1";
  }
  let suffix = 2;
  while (existing.has(`lk_${suffix}`)) {
    suffix += 1;
  }
  return `lk_${suffix}`;
}

function normalizeScaleReferenceLinePayload(rawReferenceLine) {
  if (!rawReferenceLine || typeof rawReferenceLine !== "object") {
    return null;
  }

  const x0 = finiteNumberOrNull(rawReferenceLine.x0);
  const y0 = finiteNumberOrNull(rawReferenceLine.y0);
  const x1 = finiteNumberOrNull(rawReferenceLine.x1);
  const y1 = finiteNumberOrNull(rawReferenceLine.y1);
  const meters = positiveFiniteNumber(rawReferenceLine.meters, null);

  if (x0 == null || y0 == null || x1 == null || y1 == null || meters == null) {
    return null;
  }

  return { x0, y0, x1, y1, meters };
}

function hasSameScaleCalibration(scale, nextReferenceLine, nextMetersPerWorldUnit) {
  const currentReferenceLine = scale?.referenceLine;
  const currentMetersPerWorldUnit = scale?.metersPerWorldUnit;
  return (
    currentReferenceLine != null &&
    currentMetersPerWorldUnit != null &&
    currentReferenceLine.x0 === nextReferenceLine.x0 &&
    currentReferenceLine.y0 === nextReferenceLine.y0 &&
    currentReferenceLine.x1 === nextReferenceLine.x1 &&
    currentReferenceLine.y1 === nextReferenceLine.y1 &&
    currentReferenceLine.meters === nextReferenceLine.meters &&
    currentMetersPerWorldUnit === nextMetersPerWorldUnit
  );
}

function finiteNumberOrNull(value) {
  return Number.isFinite(value) ? value : null;
}

function positiveFiniteNumber(value, fallback) {
  return Number.isFinite(value) && value > 0 ? value : fallback;
}

function nonNegativeFiniteNumber(value, fallback) {
  return Number.isFinite(value) && value >= 0 ? value : fallback;
}

function normalizeWallCm(rawWallCm) {
  const wallCm = rawWallCm && typeof rawWallCm === "object" ? rawWallCm : {};
  return {
    top: nonNegativeFiniteNumber(wallCm.top, 0),
    right: nonNegativeFiniteNumber(wallCm.right, 0),
    bottom: nonNegativeFiniteNumber(wallCm.bottom, 0),
    left: nonNegativeFiniteNumber(wallCm.left, 0)
  };
}

function normalizeWallSide(side) {
  if (side === "top" || side === "right" || side === "bottom" || side === "left") {
    return side;
  }
  return null;
}

function normalizeRoomType(roomType) {
  if (typeof roomType !== "string") {
    return DEFAULT_ROOM_TYPE;
  }
  const normalized = roomType.trim().toLowerCase().replaceAll("-", "_").replaceAll(/\s+/g, "_");
  return ROOM_TYPE_SET.has(normalized) ? normalized : DEFAULT_ROOM_TYPE;
}

function normalizeRoomName(name) {
  if (typeof name !== "string") {
    return null;
  }
  const trimmed = name.trim();
  if (!trimmed) {
    return null;
  }
  return trimmed;
}

function normalizeNonEmptyString(value) {
  if (typeof value !== "string") {
    return null;
  }
  const normalized = value.trim();
  return normalized ? normalized : null;
}

function normalizeRectangleKind(kind) {
  if (kind === "roomRect" || kind === "wallRect") {
    return kind;
  }
  return null;
}

function resolveSharedExistingRoomId(rectangles) {
  if (!Array.isArray(rectangles) || rectangles.length === 0) {
    return null;
  }

  const firstRoomId = normalizeNonEmptyString(rectangles[0]?.roomId);
  if (!firstRoomId) {
    return null;
  }

  for (let index = 1; index < rectangles.length; index += 1) {
    const roomId = normalizeNonEmptyString(rectangles[index]?.roomId);
    if (roomId !== firstRoomId) {
      return null;
    }
  }
  return firstRoomId;
}

function resolveMergeRoomName(requestedRoomName, existingRoomName) {
  const normalizedRequested = normalizeRoomName(requestedRoomName);
  if (normalizedRequested) {
    return normalizedRequested;
  }
  const normalizedExisting = normalizeRoomName(existingRoomName);
  if (normalizedExisting) {
    return normalizedExisting;
  }
  return DEFAULT_MERGED_ROOM_NAME;
}
