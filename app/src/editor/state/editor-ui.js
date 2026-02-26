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
    tool: "navigate",
    viewport: {
      cssWidth: 1,
      cssHeight: 1,
      dpr: 1
    },
    camera: { ...DEFAULT_CAMERA },
    selection: {
      rectangleId: null
    },
    interaction: {
      mode: "idle",
      pointerId: null,
      lastScreen: null,
      dragRectangle: null
    }
  };
}

export function editorUiReducer(state, action) {
  switch (action.type) {
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
          dragRectangle: null
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
          }
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
          dragRectangle: null
        }
      };

    default:
      return state;
  }
}
