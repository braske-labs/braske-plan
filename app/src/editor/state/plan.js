import { deriveTouchingAdjacency, isConnectedSelection } from "../geometry/room-merge.js";

const PLAN_VERSION = 1;
const DEFAULT_ROOM_TYPE = "generic";
const DEFAULT_MERGED_ROOM_NAME = "Merged Room";
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
    entities: {
      rectangles: [],
      openings: [],
      rooms: []
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

      return stampPlan({
        ...plan,
        entities: {
          ...plan.entities,
          rectangles: nextRectangles,
          openings: nextOpenings,
          rooms: nextRooms
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

      return stampPlan({
        ...plan,
        entities: {
          ...plan.entities,
          rectangles: nextRectangles
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

      return stampPlan({
        ...plan,
        entities: {
          ...plan.entities,
          rectangles: nextRectangles
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

      return stampPlan({
        ...plan,
        entities: {
          ...plan.entities,
          rectangles: nextRectangles
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

      return stampPlan({
        ...plan,
        entities: {
          ...plan.entities,
          rectangles: nextRectangles,
          rooms: nextRooms
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
