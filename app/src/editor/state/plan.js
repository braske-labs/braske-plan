const PLAN_VERSION = 1;

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
  if (!Array.isArray(rooms) || rooms.length === 0) {
    return [];
  }

  const nextRooms = [];
  for (const room of rooms) {
    const rectangleIds = Array.isArray(room.rectangleIds)
      ? room.rectangleIds.filter((rectangleId) => rectangleId !== deletedRectangleId)
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
