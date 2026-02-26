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
