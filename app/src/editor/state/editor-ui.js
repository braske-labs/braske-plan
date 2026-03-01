import { panCameraByScreenDelta, zoomCameraAtScreenPoint } from "../geometry/coordinates.js";

const DEFAULT_CAMERA = {
  x: -120,
  y: -80,
  zoom: 1,
  minZoom: 0.2,
  maxZoom: 6
};

export function createInitialEditorState() {
  return {
    tool: "navigate", // "navigate" | "drawRect" | "calibrateScale" | "mergeRoom"
    viewport: {
      cssWidth: 1,
      cssHeight: 1,
      dpr: 1
    },
    camera: { ...DEFAULT_CAMERA },
    selection: {
      rectangleId: null
    },
    roomSelection: {
      roomId: null
    },
    mergeSelection: {
      rectangleIds: []
    },
    mergeOptions: {
      allowInternalSeamAdjust: false
    },
    debug: {
      showBaseboardOverlay: false
    },
    interaction: {
      mode: "idle",
      pointerId: null,
      lastScreen: null,
      dragRectangle: null,
      drawRectDraft: null,
      resizeRectangle: null,
      calibrationDraft: null
    }
  };
}

export function editorUiReducer(state, action) {
  switch (action.type) {
    case "editor/tool/set": {
      const nextTool = normalizeEditorTool(action.tool);
      if (!nextTool || state.tool === nextTool) {
        return state;
      }
      return {
        ...state,
        tool: nextTool,
        mergeSelection: nextTool === "mergeRoom"
          ? state.mergeSelection
          : { rectangleIds: [] }
      };
    }

    case "editor/merge/toggleRectangle": {
      const rectangleId = normalizeRectangleId(action.rectangleId);
      if (!rectangleId) {
        return state;
      }

      const currentIds = Array.isArray(state.mergeSelection?.rectangleIds)
        ? state.mergeSelection.rectangleIds
        : [];
      const hasRectangle = currentIds.includes(rectangleId);
      const nextRectangleIds = hasRectangle
        ? currentIds.filter((candidateId) => candidateId !== rectangleId)
        : [...currentIds, rectangleId];

      if (
        nextRectangleIds.length === currentIds.length &&
        nextRectangleIds.every((candidateId, index) => candidateId === currentIds[index])
      ) {
        return state;
      }

      return {
        ...state,
        mergeSelection: {
          rectangleIds: nextRectangleIds
        }
      };
    }

    case "editor/merge/clear":
      if (!Array.isArray(state.mergeSelection?.rectangleIds) || state.mergeSelection.rectangleIds.length === 0) {
        return state;
      }
      return {
        ...state,
        mergeSelection: {
          rectangleIds: []
        }
      };

    case "editor/merge/toggleInternalAdjust":
      return {
        ...state,
        mergeOptions: {
          ...state.mergeOptions,
          allowInternalSeamAdjust: !Boolean(state.mergeOptions?.allowInternalSeamAdjust)
        }
      };

    case "editor/selection/set":
      if (state.selection.rectangleId === action.rectangleId) {
        return state;
      }
      return {
        ...state,
        selection: {
          rectangleId: action.rectangleId
        }
      };

    case "editor/roomSelection/set": {
      const roomId = normalizeRoomId(action.roomId);
      if (state.roomSelection.roomId === roomId) {
        return state;
      }
      return {
        ...state,
        roomSelection: {
          roomId
        }
      };
    }

    case "editor/roomSelection/clear":
      if (state.roomSelection.roomId == null) {
        return state;
      }
      return {
        ...state,
        roomSelection: {
          roomId: null
        }
      };

    case "editor/selection/clear":
      if (state.selection.rectangleId == null) {
        return state;
      }
      return {
        ...state,
        selection: {
          rectangleId: null
        }
      };

    case "editor/debug/toggleBaseboardOverlay":
      return {
        ...state,
        debug: {
          ...state.debug,
          showBaseboardOverlay: !state.debug.showBaseboardOverlay
        }
      };

    case "editor/debug/setBaseboardOverlay": {
      const show = Boolean(action.show);
      if (Boolean(state.debug?.showBaseboardOverlay) === show) {
        return state;
      }
      return {
        ...state,
        debug: {
          ...state.debug,
          showBaseboardOverlay: show
        }
      };
    }

    case "editor/viewport/set":
      return {
        ...state,
        viewport: {
          cssWidth: action.cssWidth,
          cssHeight: action.cssHeight,
          dpr: action.dpr
        }
      };

    case "editor/camera/reset":
      return {
        ...state,
        camera: { ...DEFAULT_CAMERA }
      };

    case "editor/camera/setPose": {
      const nextX = Number.isFinite(action.x) ? action.x : state.camera.x;
      const nextY = Number.isFinite(action.y) ? action.y : state.camera.y;
      const nextZoomRaw = Number.isFinite(action.zoom) ? action.zoom : state.camera.zoom;
      const minZoom = state.camera.minZoom ?? DEFAULT_CAMERA.minZoom;
      const maxZoom = state.camera.maxZoom ?? DEFAULT_CAMERA.maxZoom;
      const nextZoom = Math.min(maxZoom, Math.max(minZoom, nextZoomRaw));
      if (
        nextX === state.camera.x &&
        nextY === state.camera.y &&
        nextZoom === state.camera.zoom
      ) {
        return state;
      }
      return {
        ...state,
        camera: {
          ...state.camera,
          x: nextX,
          y: nextY,
          zoom: nextZoom
        }
      };
    }

    case "editor/camera/panByScreenDelta":
      return {
        ...state,
        camera: panCameraByScreenDelta(state.camera, action.dx, action.dy)
      };

    case "editor/camera/zoomAtScreenPoint":
      return {
        ...state,
        camera: zoomCameraAtScreenPoint(
          state.camera,
          action.screenX,
          action.screenY,
          action.deltaY,
          { minZoom: state.camera.minZoom, maxZoom: state.camera.maxZoom }
        )
      };

    case "editor/interaction/panStart":
      return {
        ...state,
        interaction: {
          mode: "panning",
          pointerId: action.pointerId,
          lastScreen: { x: action.screenX, y: action.screenY },
          dragRectangle: null,
          drawRectDraft: null,
          resizeRectangle: null,
          calibrationDraft: null
        }
      };

    case "editor/interaction/panMove":
      if (
        state.interaction.mode !== "panning" ||
        state.interaction.pointerId !== action.pointerId
      ) {
        return state;
      }
      return {
        ...state,
        interaction: {
          ...state.interaction,
          lastScreen: { x: action.screenX, y: action.screenY }
        }
      };

    case "editor/interaction/rectDragStart":
      return {
        ...state,
        interaction: {
          mode: "draggingRect",
          pointerId: action.pointerId,
          lastScreen: { x: action.screenX, y: action.screenY },
          dragRectangle: {
            rectangleId: action.rectangleId,
            offsetX: action.offsetX,
            offsetY: action.offsetY
          },
          drawRectDraft: null,
          resizeRectangle: null,
          calibrationDraft: null
        }
      };

    case "editor/interaction/rectDragMove":
      if (
        state.interaction.mode !== "draggingRect" ||
        state.interaction.pointerId !== action.pointerId
      ) {
        return state;
      }
      return {
        ...state,
        interaction: {
          ...state.interaction,
          lastScreen: { x: action.screenX, y: action.screenY }
        }
      };

    case "editor/interaction/drawRectStart":
      return {
        ...state,
        interaction: {
          mode: "drawingRect",
          pointerId: action.pointerId,
          lastScreen: { x: action.screenX, y: action.screenY },
          dragRectangle: null,
          drawRectDraft: {
            startWorld: { x: action.startWorldX, y: action.startWorldY },
            currentWorld: { x: action.startWorldX, y: action.startWorldY }
          },
          resizeRectangle: null,
          calibrationDraft: null
        }
      };

    case "editor/interaction/drawRectMove":
      if (
        state.interaction.mode !== "drawingRect" ||
        state.interaction.pointerId !== action.pointerId ||
        !state.interaction.drawRectDraft
      ) {
        return state;
      }
      return {
        ...state,
        interaction: {
          ...state.interaction,
          lastScreen: { x: action.screenX, y: action.screenY },
          drawRectDraft: {
            ...state.interaction.drawRectDraft,
            currentWorld: { x: action.currentWorldX, y: action.currentWorldY }
          }
        }
      };

    case "editor/interaction/resizeStart":
      return {
        ...state,
        interaction: {
          mode: "resizingRect",
          pointerId: action.pointerId,
          lastScreen: { x: action.screenX, y: action.screenY },
          dragRectangle: null,
          drawRectDraft: null,
          resizeRectangle: {
            rectangleId: action.rectangleId,
            handleName: action.handleName,
            seamSlide: action.seamSlide ?? null,
            snapshot: {
              x: action.rectX,
              y: action.rectY,
              w: action.rectW,
              h: action.rectH
            }
          },
          calibrationDraft: null
        }
      };

    case "editor/interaction/resizeMove":
      if (
        state.interaction.mode !== "resizingRect" ||
        state.interaction.pointerId !== action.pointerId
      ) {
        return state;
      }
      return {
        ...state,
        interaction: {
          ...state.interaction,
          lastScreen: { x: action.screenX, y: action.screenY }
        }
      };

    case "editor/interaction/calibrationStart":
      return {
        ...state,
        interaction: {
          mode: "calibratingScale",
          pointerId: action.pointerId,
          lastScreen: { x: action.screenX, y: action.screenY },
          dragRectangle: null,
          drawRectDraft: null,
          resizeRectangle: null,
          calibrationDraft: {
            startWorld: { x: action.startWorldX, y: action.startWorldY },
            currentWorld: { x: action.startWorldX, y: action.startWorldY }
          }
        }
      };

    case "editor/interaction/calibrationMove":
      if (
        state.interaction.mode !== "calibratingScale" ||
        state.interaction.pointerId !== action.pointerId ||
        !state.interaction.calibrationDraft
      ) {
        return state;
      }
      return {
        ...state,
        interaction: {
          ...state.interaction,
          lastScreen: { x: action.screenX, y: action.screenY },
          calibrationDraft: {
            ...state.interaction.calibrationDraft,
            currentWorld: { x: action.currentWorldX, y: action.currentWorldY }
          }
        }
      };

    case "editor/interaction/end":
      if (action.pointerId != null && state.interaction.pointerId !== action.pointerId) {
        return state;
      }
      return {
        ...state,
        interaction: {
          mode: "idle",
          pointerId: null,
          lastScreen: null,
          dragRectangle: null,
          drawRectDraft: null,
          resizeRectangle: null,
          calibrationDraft: null
        }
      };

    default:
      return state;
  }
}

function normalizeEditorTool(tool) {
  if (
    tool === "navigate" ||
    tool === "drawRect" ||
    tool === "calibrateScale" ||
    tool === "mergeRoom"
  ) {
    return tool;
  }
  return null;
}

function normalizeRectangleId(rectangleId) {
  if (typeof rectangleId !== "string") {
    return null;
  }
  const trimmed = rectangleId.trim();
  return trimmed || null;
}

function normalizeRoomId(roomId) {
  if (typeof roomId !== "string") {
    return null;
  }
  const trimmed = roomId.trim();
  return trimmed || null;
}
