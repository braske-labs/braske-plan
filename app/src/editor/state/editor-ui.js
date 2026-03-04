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
    tool: "navigate", // "navigate" | "drawRect" | "calibrateScale" | "mergeRoom" | "placeSwitch" | "placeLamp" | "linkLighting" | "placeDoor" | "placeWindow"
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
    lightingSelection: {
      fixtureId: null,
      linkSwitchId: null
    },
    openingSelection: {
      openingId: null
    },
    lightingPreview: {
      switchStatesById: {}
    },
    mergeSelection: {
      rectangleIds: []
    },
    mergeOptions: {
      allowInternalSeamAdjust: false
    },
    editLocks: {
      geometryFrozen: false
    },
    debug: {
      showBaseboardOverlay: false,
      showBaseboardConflictOverlay: false
    },
    interaction: {
      mode: "idle",
      pointerId: null,
      lastScreen: null,
      dragRectangle: null,
      dragFixture: null,
      dragOpening: null,
      drawRectDraft: null,
      resizeRectangle: null,
      resizeOpening: null,
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
        lightingSelection: nextTool === "linkLighting"
          ? state.lightingSelection
          : {
              ...state.lightingSelection,
              linkSwitchId: null
            },
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

    case "editor/locks/toggleGeometryFreeze":
      return {
        ...state,
        editLocks: {
          ...state.editLocks,
          geometryFrozen: !Boolean(state.editLocks?.geometryFrozen)
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

    case "editor/lightingSelection/setFixture": {
      const fixtureId = normalizeFixtureId(action.fixtureId);
      if (state.lightingSelection.fixtureId === fixtureId) {
        return state;
      }
      return {
        ...state,
        lightingSelection: {
          ...state.lightingSelection,
          fixtureId
        }
      };
    }

    case "editor/lightingSelection/clearFixture":
      if (state.lightingSelection.fixtureId == null) {
        return state;
      }
      return {
        ...state,
        lightingSelection: {
          ...state.lightingSelection,
          fixtureId: null
        }
      };

    case "editor/openingSelection/set": {
      const openingId = normalizeOpeningId(action.openingId);
      if (state.openingSelection.openingId === openingId) {
        return state;
      }
      return {
        ...state,
        openingSelection: {
          openingId
        }
      };
    }

    case "editor/openingSelection/clear":
      if (state.openingSelection.openingId == null) {
        return state;
      }
      return {
        ...state,
        openingSelection: {
          openingId: null
        }
      };

    case "editor/lightingPreview/toggleSwitch": {
      const switchId = normalizeFixtureId(action.switchId);
      if (!switchId) {
        return state;
      }
      const currentStates = isPlainObject(state.lightingPreview?.switchStatesById)
        ? state.lightingPreview.switchStatesById
        : {};
      const currentState = currentStates[switchId];
      const nextState = currentState === false;
      return {
        ...state,
        lightingPreview: {
          ...state.lightingPreview,
          switchStatesById: {
            ...currentStates,
            [switchId]: nextState
          }
        }
      };
    }

    case "editor/lightingPreview/clear":
      return {
        ...state,
        lightingPreview: {
          ...state.lightingPreview,
          switchStatesById: {}
        }
      };

    case "editor/lightingLink/setSwitch": {
      const switchId = normalizeFixtureId(action.switchId);
      if (state.lightingSelection.linkSwitchId === switchId) {
        return state;
      }
      return {
        ...state,
        lightingSelection: {
          ...state.lightingSelection,
          linkSwitchId: switchId
        }
      };
    }

    case "editor/lightingLink/clearSwitch":
      if (state.lightingSelection.linkSwitchId == null) {
        return state;
      }
      return {
        ...state,
        lightingSelection: {
          ...state.lightingSelection,
          linkSwitchId: null
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

    case "editor/debug/toggleBaseboardConflictOverlay":
      return {
        ...state,
        debug: {
          ...state.debug,
          showBaseboardConflictOverlay: !Boolean(state.debug?.showBaseboardConflictOverlay)
        }
      };

    case "editor/debug/setBaseboardConflictOverlay": {
      const show = Boolean(action.show);
      if (Boolean(state.debug?.showBaseboardConflictOverlay) === show) {
        return state;
      }
      return {
        ...state,
        debug: {
          ...state.debug,
          showBaseboardConflictOverlay: show
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
          dragFixture: null,
          dragOpening: null,
          drawRectDraft: null,
          resizeRectangle: null,
          resizeOpening: null,
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

    case "editor/interaction/rectDragStart": {
      const dragStartX = Number.isFinite(action.startScreenX) ? action.startScreenX : action.screenX;
      const dragStartY = Number.isFinite(action.startScreenY) ? action.startScreenY : action.screenY;
      const dragRectangleStartX = Number.isFinite(action.startRectangleX) ? action.startRectangleX : 0;
      const dragRectangleStartY = Number.isFinite(action.startRectangleY) ? action.startRectangleY : 0;
      return {
        ...state,
        interaction: {
          mode: "draggingRect",
          pointerId: action.pointerId,
          lastScreen: { x: action.screenX, y: action.screenY },
          dragRectangle: {
            rectangleId: action.rectangleId,
            offsetX: action.offsetX,
            offsetY: action.offsetY,
            startScreenX: dragStartX,
            startScreenY: dragStartY,
            startRectangleX: dragRectangleStartX,
            startRectangleY: dragRectangleStartY,
            groupRectangles: normalizeDragGroupRectangles(action.groupRectangles)
          },
          dragFixture: null,
          dragOpening: null,
          drawRectDraft: null,
          resizeRectangle: null,
          resizeOpening: null,
          calibrationDraft: null
        }
      };
    }

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

    case "editor/interaction/fixtureDragStart":
      return {
        ...state,
        interaction: {
          mode: "draggingFixture",
          pointerId: action.pointerId,
          lastScreen: { x: action.screenX, y: action.screenY },
          dragRectangle: null,
          dragFixture: {
            fixtureId: action.fixtureId,
            offsetX: action.offsetX,
            offsetY: action.offsetY
          },
          dragOpening: null,
          drawRectDraft: null,
          resizeRectangle: null,
          resizeOpening: null,
          calibrationDraft: null
        }
      };

    case "editor/interaction/openingDragStart":
      return {
        ...state,
        interaction: {
          mode: "draggingOpening",
          pointerId: action.pointerId,
          lastScreen: { x: action.screenX, y: action.screenY },
          dragRectangle: null,
          dragFixture: null,
          dragOpening: {
            openingId: action.openingId,
            offsetAlong: action.offsetAlong
          },
          drawRectDraft: null,
          resizeRectangle: null,
          resizeOpening: null,
          calibrationDraft: null
        }
      };

    case "editor/interaction/fixtureDragMove":
      if (
        state.interaction.mode !== "draggingFixture" ||
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

    case "editor/interaction/openingDragMove":
      if (
        state.interaction.mode !== "draggingOpening" ||
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
          dragFixture: null,
          dragOpening: null,
          drawRectDraft: {
            startWorld: { x: action.startWorldX, y: action.startWorldY },
            currentWorld: { x: action.startWorldX, y: action.startWorldY }
          },
          resizeRectangle: null,
          resizeOpening: null,
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
          dragFixture: null,
          dragOpening: null,
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
          resizeOpening: null,
          calibrationDraft: null
        }
      };

    case "editor/interaction/openingResizeStart":
      return {
        ...state,
        interaction: {
          mode: "resizingOpening",
          pointerId: action.pointerId,
          lastScreen: { x: action.screenX, y: action.screenY },
          dragRectangle: null,
          dragFixture: null,
          dragOpening: null,
          drawRectDraft: null,
          resizeRectangle: null,
          resizeOpening: {
            openingId: action.openingId,
            edge: action.edge
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

    case "editor/interaction/openingResizeMove":
      if (
        state.interaction.mode !== "resizingOpening" ||
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
          dragFixture: null,
          dragOpening: null,
          drawRectDraft: null,
          resizeRectangle: null,
          resizeOpening: null,
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
          dragFixture: null,
          dragOpening: null,
          drawRectDraft: null,
          resizeRectangle: null,
          resizeOpening: null,
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
    tool === "mergeRoom" ||
    tool === "placeSwitch" ||
    tool === "placeLamp" ||
    tool === "linkLighting" ||
    tool === "placeDoor" ||
    tool === "placeWindow"
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

function normalizeFixtureId(fixtureId) {
  if (typeof fixtureId !== "string") {
    return null;
  }
  const trimmed = fixtureId.trim();
  return trimmed || null;
}

function normalizeOpeningId(openingId) {
  if (typeof openingId !== "string") {
    return null;
  }
  const trimmed = openingId.trim();
  return trimmed || null;
}

function normalizeDragGroupRectangles(groupRectangles) {
  if (!Array.isArray(groupRectangles)) {
    return [];
  }
  const normalized = [];
  for (const candidate of groupRectangles) {
    const id = normalizeRectangleId(candidate?.id);
    const x = candidate?.x;
    const y = candidate?.y;
    const w = candidate?.w;
    const h = candidate?.h;
    if (!id || !Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(w) || !Number.isFinite(h)) {
      continue;
    }
    normalized.push({ id, x, y, w, h });
  }
  return normalized;
}

function isPlainObject(value) {
  return value != null && typeof value === "object" && !Array.isArray(value);
}
