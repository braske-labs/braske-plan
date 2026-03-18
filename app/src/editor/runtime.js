import { screenToWorld, worldToScreen } from "./geometry/coordinates.js";
import {
  computeRectangleDragOffset,
  computeRectanglePositionFromPointer,
  getResizeHandles,
  hitTestRectangles,
  hitTestResizeHandles,
  normalizeRectangleFromPoints,
  rectangleMeetsMinimumSize,
  resizeRectangleFromHandle
} from "./geometry/rectangles.js";
import {
  buildScaleCalibration,
  computeMetersPerWorldUnitFromArea,
  distanceBetweenWorldPoints,
  formatMetersAndCentimeters,
  worldLengthToMeters
} from "./geometry/scale.js";
import { deriveBaseboardCandidates } from "./geometry/baseboards.js";
import { deriveBaseboardExportSnapshot } from "./geometry/baseboard-snapshot.js";
import {
  deriveLockedSeamSides,
  deriveRoomSeams,
  deriveTouchingAdjacency,
  isConnectedSelection
} from "./geometry/room-merge.js";
import { snapDraggedRectangle, snapResizedRectangle } from "./geometry/snapping.js";
import { validateBasicPlanGeometry } from "./geometry/validation.js";
import {
  deriveRectangleShellGeometry,
  getRectangleOuterRect,
  getRectangleWallWorld,
  interiorRectToOuterRect,
  normalizeWallCm,
  outerRectToInteriorRect
} from "./geometry/wall-shell.js";
import {
  updateActiveRevision,
} from "../api/planner-api.js";
import {
  createPlanAutosaveController,
  parseImportedPlanJsonText
} from "./persistence/plan-persistence.js";
import { createInitialEditorState } from "./state/editor-ui.js";
import { createEmptyPlan } from "./state/plan.js";
import { createEditorSessionStore } from "./state/session-store.js";

const MIN_RECT_SIZE = 16;
const HANDLE_SIZE_PX = 14;
const BACKGROUND_NUDGE_STEP = 20;
const BACKGROUND_OPACITY_STEP = 0.05;
const BACKGROUND_SCALE_UP = 1.05;
const BACKGROUND_SCALE_DOWN = 1 / BACKGROUND_SCALE_UP;
const SNAP_TOLERANCE_PX = 10;
const RECT_DRAG_DEADZONE_PX = 5;
const METRIC_DRAG_QUANTIZATION_STEP_METERS = 0.01;
const DEFAULT_DRAG_QUANTIZATION_WORLD = 1;
const MIN_CALIBRATION_LINE_WORLD = 8;
const WALL_CM_STEP = 1;
const DEFAULT_ROOM_TYPE = "generic";
const DEFAULT_PAINT_WALL_HEIGHT_METERS = 2.7;
const OVERLAP_FLASH_PAIR_DURATION_MS = 1100;
const OVERLAP_FLASH_BLINK_PERIOD_MS = 320;
const FIXTURE_HIT_RADIUS_PX = 14;
const FIXTURE_SWITCH_RADIUS_WORLD = 10;
const FIXTURE_LAMP_RADIUS_WORLD = 8;
const OPENING_HIT_DISTANCE_PX = 12;
const OPENING_HANDLE_SIZE_PX = 11;
const MIN_OPENING_WIDTH_WORLD = 24;
const DEFAULT_OPENING_WIDTH_WORLD = 90;
const ESTIMATE_CURRENCY_SYMBOL = "€";
const BASEBOARD_EXCLUDED_ROOM_TYPES = Object.freeze(["bathroom", "toilet"]);
const DEFAULT_QUOTE_MODEL = Object.freeze({
  groupMode: "room",
  catalog: {
    baseboardProfiles: [
      { id: "baseboard_standard", name: "Baseboard Standard", materialPerM: 6, laborPerM: 12 }
    ],
    flooringTypes: [
      { id: "floor_standard", name: "Floor Standard", materialPerM2: 14, laborPerM2: 14 },
      { id: "floor_tiles", name: "Tiles", materialPerM2: 24, laborPerM2: 22 }
    ],
    paintingTypes: [
      { id: "paint_standard", name: "Paint Standard", materialPerM2: 2.5, laborPerM2: 7 }
    ],
    switchProducts: [
      { id: "switch_standard", name: "Switch Standard", unitPrice: 22 }
    ],
    lampProducts: [
      { id: "lamp_standard", name: "Lamp Standard", unitPrice: 16 }
    ],
    doorProducts: [
      { id: "door_standard", name: "Door Standard", unitPrice: 145 }
    ]
  },
  defaults: {
    baseboardProfileId: "baseboard_standard",
    flooringTypeId: "floor_standard",
    paintingTypeId: "paint_standard",
    switchProductId: "switch_standard",
    lampProductId: "lamp_standard",
    doorProductId: "door_standard"
  },
  roomConfigs: {}
});

export function mountEditorRuntime(options) {
  const {
    canvas,
    statusElement,
    overlayElement,
    shellElement,
    initialPlan = null,
    backendProjectId = null,
    controls = {}
  } = options;
  const context = canvas.getContext("2d");
  if (!context) {
    throw new Error("2D canvas context is required");
  }

  const resolvedInitialPlan = initialPlan ?? createEmptyPlan();
  let persistenceStatus = {
    loadSource: initialPlan ? "bootstrap" : "default",
    phase: "idle",
    lastSavedAt: null,
    lastActionType: null,
    errorMessage: null
  };

  const store = createEditorSessionStore({
    plan: resolvedInitialPlan,
    editorState: createInitialEditorState()
  });

  const autosaveController = createPlanAutosaveController(store, {
    backendProjectId,
    onPersistPlan(plan) {
      if (!backendProjectId) {
        return Promise.resolve();
      }
      return updateActiveRevision(backendProjectId, { plan_json: plan });
    },
    onStatus(nextStatus) {
      persistenceStatus = {
        ...persistenceStatus,
        ...nextStatus
      };
    }
  });

  if (!initialPlan) {
    store.dispatch({ type: "plan/debugSeedRectangles" });
  }

  let destroyed = false;
  let rafId = 0;
  let frameCount = 0;
  let lastFpsSampleMs = performance.now();
  let framesSinceSample = 0;
  let fps = 0;
  const pointerHover = { active: false, screenX: 0, screenY: 0 };
  const backgroundImageState = {
    src: null,
    image: null,
    status: "idle",
    errorMessage: null
  };
  let fileTransferStatus = {
    phase: "idle",
    lastAction: null,
    message: null,
    at: null
  };
  let lastValidatedPlan = null;
  let lastValidationResult = null;
  let lastBaseboardPlan = null;
  let lastBaseboardResult = null;
  let lastBaseboardConflictSource = null;
  let lastBaseboardConflictResult = null;
  let lastLockedSeamsPlan = null;
  let lastLockedSeamSides = null;
  let nextUserRectangleId = deriveNextUserRectangleId(store.getState().plan);
  let nextUserFixtureId = deriveNextUserFixtureId(store.getState().plan);
  let nextUserOpeningId = deriveNextUserOpeningId(store.getState().plan);
  const roomTreeOpenIds = new Set();
  let estimatePanelOpen = false;

  const resize = () => {
    const rect = canvas.getBoundingClientRect();
    const cssWidth = Math.max(1, Math.floor(rect.width));
    const cssHeight = Math.max(1, Math.floor(rect.height));
    const dpr = window.devicePixelRatio || 1;

    if (canvas.width !== Math.floor(cssWidth * dpr) || canvas.height !== Math.floor(cssHeight * dpr)) {
      canvas.width = Math.floor(cssWidth * dpr);
      canvas.height = Math.floor(cssHeight * dpr);
    }

    store.dispatch({
      type: "editor/viewport/set",
      cssWidth,
      cssHeight,
      dpr
    });
  };

  const resizeObserver = typeof ResizeObserver !== "undefined"
    ? new ResizeObserver(() => resize())
    : null;

  if (resizeObserver) {
    resizeObserver.observe(canvas);
  }
  window.addEventListener("resize", resize);

  const onPointerDown = (event) => {
    if (event.button !== 0 && event.button !== 1) return;
    const point = toCanvasLocalPoint(canvas, event.clientX, event.clientY);
    const state = store.getState();
    const { editorState, plan } = state;
    const geometryFrozen = isGeometryEditingFrozen(editorState);
    const worldPoint = screenToWorld(editorState.camera, point.x, point.y);
    const selectedRectangle = getSelectedRectangle(plan, editorState);
    const selectedOpening = getSelectedOpening(plan, editorState);
    const fixtureHit = hitTestLightingFixtures(plan, worldPoint, editorState.camera.zoom);
    const openingHit = hitTestOpenings(plan, worldPoint, editorState.camera.zoom);
    const openingHandleHit = (
      editorState.tool === "navigate" && selectedOpening
    )
      ? hitTestOpeningResizeHandles(plan, selectedOpening, worldPoint, editorState.camera.zoom)
      : null;

    if (event.button === 1) {
      canvas.setPointerCapture(event.pointerId);
      store.dispatch({
        type: "editor/interaction/panStart",
        pointerId: event.pointerId,
        screenX: event.clientX,
        screenY: event.clientY
      });
      syncEditorChrome();
      return;
    }

    if (editorState.tool === "drawRect") {
      if (geometryFrozen) {
        syncEditorChrome();
        return;
      }
      store.dispatch({ type: "editor/selection/clear" });
      store.dispatch({ type: "editor/lightingSelection/clearFixture" });
      store.dispatch({ type: "editor/openingSelection/clear" });
      canvas.setPointerCapture(event.pointerId);
      store.dispatch({
        type: "editor/interaction/drawRectStart",
        pointerId: event.pointerId,
        screenX: event.clientX,
        screenY: event.clientY,
        startWorldX: worldPoint.x,
        startWorldY: worldPoint.y
      });
      syncEditorChrome();
      return;
    }

    if (editorState.tool === "calibrateScale") {
      store.dispatch({ type: "editor/selection/clear" });
      store.dispatch({ type: "editor/lightingSelection/clearFixture" });
      store.dispatch({ type: "editor/openingSelection/clear" });
      canvas.setPointerCapture(event.pointerId);
      store.dispatch({
        type: "editor/interaction/calibrationStart",
        pointerId: event.pointerId,
        screenX: event.clientX,
        screenY: event.clientY,
        startWorldX: worldPoint.x,
        startWorldY: worldPoint.y
      });
      syncEditorChrome();
      return;
    }

    if (editorState.tool === "placeSwitch") {
      const didCreate = createSwitchFixtureAtPointer(worldPoint);
      if (didCreate) {
        syncEditorChrome();
      }
      return;
    }

    if (editorState.tool === "placeLamp") {
      const didCreate = createLampFixtureAtPointer(worldPoint);
      if (didCreate) {
        syncEditorChrome();
      }
      return;
    }

    if (editorState.tool === "placeDoor") {
      const didCreate = createOpeningAtPointer(worldPoint, "door", editorState.camera.zoom);
      if (didCreate) {
        syncEditorChrome();
      }
      return;
    }

    if (editorState.tool === "placeWindow") {
      const didCreate = createOpeningAtPointer(worldPoint, "window", editorState.camera.zoom);
      if (didCreate) {
        syncEditorChrome();
      }
      return;
    }

    if (editorState.tool === "linkLighting") {
      if (!fixtureHit) {
        return;
      }
      const fixture = fixtureHit.fixture;
      store.dispatch({ type: "editor/selection/clear" });
      store.dispatch({ type: "editor/lightingSelection/setFixture", fixtureId: fixture.id });
      store.dispatch({ type: "editor/openingSelection/clear" });
      if (fixture.kind === "switch") {
        store.dispatch({ type: "editor/lightingLink/setSwitch", switchId: fixture.id });
      } else if (fixture.kind === "lamp") {
        const sourceSwitchId = normalizeRectangleIdForUi(editorState?.lightingSelection?.linkSwitchId);
        if (sourceSwitchId) {
          toggleLightingSwitchLinkToLamp(fixture.id);
        }
      }
      syncEditorChrome();
      return;
    }

    if (editorState.tool === "mergeRoom") {
      if (geometryFrozen) {
        syncEditorChrome();
        return;
      }
      const hit = hitTestRectangles(plan.entities.rectangles, worldPoint, {
        getBounds: (rectangle) => getRectangleHitBounds(rectangle, plan.scale)
      });
      if (!hit || hit.rectangle.kind === "wallRect") {
        return;
      }
      store.dispatch({
        type: "editor/selection/set",
        rectangleId: hit.rectangle.id
      });
      store.dispatch({ type: "editor/openingSelection/clear" });
      syncRoomSelectionFromRectangle(hit.rectangle);
      store.dispatch({
        type: "editor/merge/toggleRectangle",
        rectangleId: hit.rectangle.id
      });
      syncEditorChrome();
      return;
    }

    if (openingHandleHit) {
      if (geometryFrozen) {
        syncEditorChrome();
        return;
      }
      store.dispatch({ type: "editor/selection/clear" });
      store.dispatch({ type: "editor/lightingSelection/clearFixture" });
      store.dispatch({
        type: "editor/openingSelection/set",
        openingId: openingHandleHit.opening.id
      });
      canvas.setPointerCapture(event.pointerId);
      store.dispatch({
        type: "editor/interaction/openingResizeStart",
        pointerId: event.pointerId,
        screenX: event.clientX,
        screenY: event.clientY,
        openingId: openingHandleHit.opening.id,
        edge: openingHandleHit.edge
      });
      syncEditorChrome();
      return;
    }

    if (openingHit) {
      const opening = openingHit.opening;
      store.dispatch({ type: "editor/selection/clear" });
      store.dispatch({ type: "editor/lightingSelection/clearFixture" });
      store.dispatch({
        type: "editor/openingSelection/set",
        openingId: opening.id
      });

      if (editorState.tool === "navigate" && !geometryFrozen) {
        canvas.setPointerCapture(event.pointerId);
        store.dispatch({
          type: "editor/interaction/openingDragStart",
          pointerId: event.pointerId,
          screenX: event.clientX,
          screenY: event.clientY,
          openingId: opening.id,
          offsetAlong: openingHit.centerAlong - openingHit.pointerAlong
        });
      }
      syncEditorChrome();
      return;
    }

    if (fixtureHit) {
      const fixture = fixtureHit.fixture;
      store.dispatch({ type: "editor/selection/clear" });
      store.dispatch({ type: "editor/lightingSelection/setFixture", fixtureId: fixture.id });
      store.dispatch({ type: "editor/openingSelection/clear" });

      if (editorState.tool === "navigate") {
        const dragOffset = {
          x: worldPoint.x - fixture.x,
          y: worldPoint.y - fixture.y
        };
        canvas.setPointerCapture(event.pointerId);
        store.dispatch({
          type: "editor/interaction/fixtureDragStart",
          pointerId: event.pointerId,
          screenX: event.clientX,
          screenY: event.clientY,
          fixtureId: fixture.id,
          offsetX: dragOffset.x,
          offsetY: dragOffset.y
        });
      }
      syncEditorChrome();
      return;
    }

    const lockedSeamSides = getLockedSeamSides(plan);
    if (selectedRectangle) {
      const handleHit = hitTestResizeHandles(selectedRectangle, worldPoint, editorState.camera.zoom, {
        handleSizePx: HANDLE_SIZE_PX
      });
      if (handleHit) {
        if (geometryFrozen) {
          syncEditorChrome();
          return;
        }
        const lockedSides = lockedSeamSides.get(selectedRectangle.id);
        const handleBlockedByLockedSeam = isResizeHandleBlockedByLockedSides(handleHit.name, lockedSides);
        let seamSlideDescriptor = null;
        if (handleBlockedByLockedSeam && isInternalSeamSlideAdjustEnabled(editorState)) {
          seamSlideDescriptor = deriveInternalSeamSlideStartDescriptor(plan, selectedRectangle.id, handleHit.name);
        }
        if (handleBlockedByLockedSeam && !seamSlideDescriptor) {
          syncEditorChrome();
          return;
        }
        canvas.setPointerCapture(event.pointerId);
        store.dispatch({
          type: "editor/interaction/resizeStart",
          pointerId: event.pointerId,
          screenX: event.clientX,
          screenY: event.clientY,
          rectangleId: selectedRectangle.id,
          handleName: handleHit.name,
          rectX: selectedRectangle.x,
          rectY: selectedRectangle.y,
          rectW: selectedRectangle.w,
          rectH: selectedRectangle.h,
          seamSlide: seamSlideDescriptor
        });
        syncEditorChrome();
        return;
      }
    }

    const hit = hitTestRectangles(plan.entities.rectangles, worldPoint, {
      getBounds: (rectangle) => getRectangleHitBounds(rectangle, plan.scale)
    });
    if (hit) {
      store.dispatch({ type: "editor/lightingSelection/clearFixture" });
      store.dispatch({ type: "editor/openingSelection/clear" });
      store.dispatch({
        type: "editor/selection/set",
        rectangleId: hit.rectangle.id
      });
      syncRoomSelectionFromRectangle(hit.rectangle);
      if (geometryFrozen) {
        syncEditorChrome();
        return;
      }
      const dragOffset = computeRectangleDragOffset(hit.rectangle, worldPoint);
      const dragGroupRectangleIds = getDragGroupRectangleIds(plan, hit.rectangle);
      const dragGroupRectangles = dragGroupRectangleIds
        .map((rectangleId) => plan.entities.rectangles.find((rectangle) => rectangle.id === rectangleId))
        .filter(Boolean)
        .map((rectangle) => ({
          id: rectangle.id,
          x: rectangle.x,
          y: rectangle.y,
          w: rectangle.w,
          h: rectangle.h
        }));
      canvas.setPointerCapture(event.pointerId);
      store.dispatch({
        type: "editor/interaction/rectDragStart",
        pointerId: event.pointerId,
        screenX: event.clientX,
        screenY: event.clientY,
        startScreenX: event.clientX,
        startScreenY: event.clientY,
        rectangleId: hit.rectangle.id,
        offsetX: dragOffset.x,
        offsetY: dragOffset.y,
        startRectangleX: hit.rectangle.x,
        startRectangleY: hit.rectangle.y,
        groupRectangles: dragGroupRectangles
      });
      syncEditorChrome();
      return;
    }

    store.dispatch({ type: "editor/selection/clear" });
    store.dispatch({ type: "editor/lightingSelection/clearFixture" });
    store.dispatch({ type: "editor/openingSelection/clear" });
    canvas.setPointerCapture(event.pointerId);
    store.dispatch({
      type: "editor/interaction/panStart",
      pointerId: event.pointerId,
      screenX: event.clientX,
      screenY: event.clientY
    });
    syncEditorChrome();
  };

  const onPointerMove = (event) => {
    const point = toCanvasLocalPoint(canvas, event.clientX, event.clientY);
    pointerHover.active = true;
    pointerHover.screenX = point.x;
    pointerHover.screenY = point.y;

    const state = store.getState();
    if (
      state.editorState.interaction.mode === "panning" &&
      state.editorState.interaction.pointerId === event.pointerId &&
      state.editorState.interaction.lastScreen
    ) {
      const previous = state.editorState.interaction.lastScreen;
      const dx = event.clientX - previous.x;
      const dy = event.clientY - previous.y;

      if (dx !== 0 || dy !== 0) {
        store.dispatch({
          type: "editor/camera/panByScreenDelta",
          dx,
          dy
        });
      }

      store.dispatch({
        type: "editor/interaction/panMove",
        pointerId: event.pointerId,
        screenX: event.clientX,
        screenY: event.clientY
      });
      return;
    }

    if (
      state.editorState.interaction.mode === "draggingRect" &&
      state.editorState.interaction.pointerId === event.pointerId &&
      state.editorState.interaction.dragRectangle
    ) {
      if (isGeometryEditingFrozen(state.editorState)) {
        store.dispatch({ type: "editor/interaction/end", pointerId: event.pointerId });
        syncEditorChrome();
        return;
      }
      const worldPoint = screenToWorld(state.editorState.camera, point.x, point.y);
      const dragRectangle = state.editorState.interaction.dragRectangle;
      const screenDxFromStart = event.clientX - (Number.isFinite(dragRectangle.startScreenX)
        ? dragRectangle.startScreenX
        : event.clientX);
      const screenDyFromStart = event.clientY - (Number.isFinite(dragRectangle.startScreenY)
        ? dragRectangle.startScreenY
        : event.clientY);
      if (!hasPointerExceededDeadzone(screenDxFromStart, screenDyFromStart, RECT_DRAG_DEADZONE_PX)) {
        store.dispatch({
          type: "editor/interaction/rectDragMove",
          pointerId: event.pointerId,
          screenX: event.clientX,
          screenY: event.clientY
        });
        return;
      }

      const nextPositionRaw = computeRectanglePositionFromPointer(worldPoint, {
        x: dragRectangle.offsetX,
        y: dragRectangle.offsetY
      });
      const draggedRectangle = state.plan.entities.rectangles.find(
        (rectangle) => rectangle.id === dragRectangle.rectangleId
      );
      if (!draggedRectangle) {
        store.dispatch({
          type: "editor/interaction/rectDragMove",
          pointerId: event.pointerId,
          screenX: event.clientX,
          screenY: event.clientY
        });
        return;
      }

      const dragGroupRectangles = Array.isArray(dragRectangle.groupRectangles) && dragRectangle.groupRectangles.length > 0
        ? dragRectangle.groupRectangles
        : [{
            id: draggedRectangle.id,
            x: draggedRectangle.x,
            y: draggedRectangle.y,
            w: draggedRectangle.w,
            h: draggedRectangle.h
          }];
      const draggedSnapshot = dragGroupRectangles.find(
        (rectangle) => rectangle.id === dragRectangle.rectangleId
      );
      if (!draggedSnapshot) {
        store.dispatch({
          type: "editor/interaction/rectDragMove",
          pointerId: event.pointerId,
          screenX: event.clientX,
          screenY: event.clientY
        });
        return;
      }
      const dragQuantizationWorld = getDragQuantizationWorld(state.plan.scale?.metersPerWorldUnit);
      const quantizedNextX = quantizeAroundAnchor(nextPositionRaw.x, draggedSnapshot.x, dragQuantizationWorld);
      const quantizedNextY = quantizeAroundAnchor(nextPositionRaw.y, draggedSnapshot.y, dragQuantizationWorld);
      const dx = quantizedNextX - draggedSnapshot.x;
      const dy = quantizedNextY - draggedSnapshot.y;

      if (dragGroupRectangles.length > 1) {
        if (dx !== 0 || dy !== 0) {
          const dragGroupRectangleIdSet = new Set(dragGroupRectangles.map((rectangle) => rectangle.id));
          let groupDx = dx;
          let groupDy = dy;
          const snapWallWorld = getRectangleWallWorld(draggedSnapshot, state.plan.scale?.metersPerWorldUnit);
          const proposedDraggedRectangle = {
            x: draggedSnapshot.x + dx,
            y: draggedSnapshot.y + dy,
            w: draggedSnapshot.w,
            h: draggedSnapshot.h
          };
          const proposedDraggedShell = interiorRectToOuterRect(proposedDraggedRectangle, snapWallWorld);
          if (proposedDraggedShell) {
            const externalShellRectangles = buildPlanShellRectangles(state.plan).filter(
              (rectangle) => !dragGroupRectangleIdSet.has(rectangle.id)
            );
            const snapResult = snapDraggedRectangle(
              proposedDraggedShell,
              externalShellRectangles,
              {
                toleranceWorld: SNAP_TOLERANCE_PX / state.editorState.camera.zoom
              }
            );
            const snappedDraggedInterior = outerRectToInteriorRect(snapResult.rectangle, snapWallWorld);
            if (snappedDraggedInterior) {
              groupDx = snappedDraggedInterior.x - draggedSnapshot.x;
              groupDy = snappedDraggedInterior.y - draggedSnapshot.y;
            }
          }

          const groupUpdates = dragGroupRectangles.map((rectangle) => ({
            id: rectangle.id,
            x: rectangle.x + groupDx,
            y: rectangle.y + groupDy,
            w: rectangle.w,
            h: rectangle.h
          }));
          applyRectangleGeometryUpdates(state.plan, groupUpdates, {
            enforceRoomConnectivity: true
          });
        }

        store.dispatch({
          type: "editor/interaction/rectDragMove",
          pointerId: event.pointerId,
          screenX: event.clientX,
          screenY: event.clientY
        });
        return;
      }

      const proposedRectangle = {
        x: quantizedNextX,
        y: quantizedNextY,
        w: draggedSnapshot.w,
        h: draggedSnapshot.h
      };
      let snappedRectangle = proposedRectangle;
      const snapWallWorld = getRectangleWallWorld(draggedSnapshot, state.plan.scale?.metersPerWorldUnit);
      const proposedShell = interiorRectToOuterRect(proposedRectangle, snapWallWorld);
      if (proposedShell) {
        const snapResult = snapDraggedRectangle(
          proposedShell,
          buildPlanShellRectangles(state.plan),
          {
            excludeRectangleId: dragRectangle.rectangleId,
            toleranceWorld: SNAP_TOLERANCE_PX / state.editorState.camera.zoom
          }
        );
        const snappedInterior = outerRectToInteriorRect(snapResult.rectangle, snapWallWorld);
        if (snappedInterior) {
          snappedRectangle = snappedInterior;
        }
      }

      applyRectangleGeometryUpdates(
        state.plan,
        [{
          id: dragRectangle.rectangleId,
          x: snappedRectangle.x,
          y: snappedRectangle.y,
          w: snappedRectangle.w,
          h: snappedRectangle.h
        }],
        { enforceRoomConnectivity: true }
      );
      store.dispatch({
        type: "editor/interaction/rectDragMove",
        pointerId: event.pointerId,
        screenX: event.clientX,
        screenY: event.clientY
      });
      return;
    }

    if (
      state.editorState.interaction.mode === "draggingFixture" &&
      state.editorState.interaction.pointerId === event.pointerId &&
      state.editorState.interaction.dragFixture
    ) {
      const worldPoint = screenToWorld(state.editorState.camera, point.x, point.y);
      const dragFixture = state.editorState.interaction.dragFixture;
      const fixture = getLightingFixtureById(state.plan, dragFixture.fixtureId);
      if (!fixture) {
        store.dispatch({
          type: "editor/interaction/fixtureDragMove",
          pointerId: event.pointerId,
          screenX: event.clientX,
          screenY: event.clientY
        });
        return;
      }

      const targetPoint = {
        x: worldPoint.x - dragFixture.offsetX,
        y: worldPoint.y - dragFixture.offsetY
      };
      if (fixture.kind === "switch") {
        const placement = projectPointToSwitchHostSide(state.plan, fixture.host, targetPoint);
        if (placement) {
          store.dispatch({
            type: "plan/lighting/moveFixture",
            fixtureId: fixture.id,
            x: placement.x,
            y: placement.y,
            roomId: fixture.roomId ?? null,
            host: placement.host
          });
        }
      } else {
        const roomRectangle = findRoomRectangleAtPoint(state.plan.entities.rectangles, targetPoint);
        const roomId = normalizeRectangleIdForUi(roomRectangle?.roomId) ?? fixture.roomId ?? null;
        const host = deriveLampInteriorHostFromRectangle(roomRectangle, targetPoint);
        store.dispatch({
          type: "plan/lighting/moveFixture",
          fixtureId: fixture.id,
          x: targetPoint.x,
          y: targetPoint.y,
          roomId,
          host
        });
      }

      store.dispatch({
        type: "editor/interaction/fixtureDragMove",
        pointerId: event.pointerId,
        screenX: event.clientX,
        screenY: event.clientY
      });
      return;
    }

    if (
      state.editorState.interaction.mode === "draggingOpening" &&
      state.editorState.interaction.pointerId === event.pointerId &&
      state.editorState.interaction.dragOpening
    ) {
      if (isGeometryEditingFrozen(state.editorState)) {
        store.dispatch({ type: "editor/interaction/end", pointerId: event.pointerId });
        syncEditorChrome();
        return;
      }
      const worldPoint = screenToWorld(state.editorState.camera, point.x, point.y);
      const dragOpening = state.editorState.interaction.dragOpening;
      const opening = getOpeningById(state.plan, dragOpening.openingId);
      const openingGeometry = opening ? deriveOpeningGeometry(state.plan, opening) : null;
      if (!opening || !openingGeometry) {
        store.dispatch({
          type: "editor/interaction/openingDragMove",
          pointerId: event.pointerId,
          screenX: event.clientX,
          screenY: event.clientY
        });
        return;
      }

      const pointerAlong = deriveOpeningAlongCoordinate(openingGeometry.side, worldPoint) - deriveOpeningAlongBase(openingGeometry);
      const nextCenterAlong = pointerAlong + (Number.isFinite(dragOpening.offsetAlong) ? dragOpening.offsetAlong : 0);
      const sideLength = openingGeometry.sideLength;
      const nextOffset = sideLength > 0 ? nextCenterAlong / sideLength : 0.5;
      store.dispatch({
        type: "plan/openings/move",
        openingId: opening.id,
        host: {
          type: "wallSide",
          rectangleId: openingGeometry.rectangle.id,
          side: openingGeometry.side,
          offset: nextOffset
        }
      });

      store.dispatch({
        type: "editor/interaction/openingDragMove",
        pointerId: event.pointerId,
        screenX: event.clientX,
        screenY: event.clientY
      });
      return;
    }

    if (
      state.editorState.interaction.mode === "resizingOpening" &&
      state.editorState.interaction.pointerId === event.pointerId &&
      state.editorState.interaction.resizeOpening
    ) {
      if (isGeometryEditingFrozen(state.editorState)) {
        store.dispatch({ type: "editor/interaction/end", pointerId: event.pointerId });
        syncEditorChrome();
        return;
      }
      const worldPoint = screenToWorld(state.editorState.camera, point.x, point.y);
      const resizeOpening = state.editorState.interaction.resizeOpening;
      const opening = getOpeningById(state.plan, resizeOpening.openingId);
      const openingGeometry = opening ? deriveOpeningGeometry(state.plan, opening) : null;
      if (!opening || !openingGeometry) {
        store.dispatch({
          type: "editor/interaction/openingResizeMove",
          pointerId: event.pointerId,
          screenX: event.clientX,
          screenY: event.clientY
        });
        return;
      }

      const pointerAlong = deriveOpeningAlongCoordinate(openingGeometry.side, worldPoint) - deriveOpeningAlongBase(openingGeometry);
      const fixedAlong = resizeOpening.edge === "start"
        ? openingGeometry.endAlong
        : openingGeometry.startAlong;
      const nextWidth = Math.max(MIN_OPENING_WIDTH_WORLD, Math.abs(pointerAlong - fixedAlong));
      const nextCenterAlong = (pointerAlong + fixedAlong) / 2;
      const nextOffset = openingGeometry.sideLength > 0
        ? nextCenterAlong / openingGeometry.sideLength
        : 0.5;
      store.dispatch({
        type: "plan/openings/move",
        openingId: opening.id,
        host: {
          type: "wallSide",
          rectangleId: openingGeometry.rectangle.id,
          side: openingGeometry.side,
          offset: nextOffset
        }
      });
      store.dispatch({
        type: "plan/openings/resize",
        openingId: opening.id,
        widthWorld: nextWidth
      });

      store.dispatch({
        type: "editor/interaction/openingResizeMove",
        pointerId: event.pointerId,
        screenX: event.clientX,
        screenY: event.clientY
      });
      return;
    }

    if (
      state.editorState.interaction.mode === "drawingRect" &&
      state.editorState.interaction.pointerId === event.pointerId &&
      state.editorState.interaction.drawRectDraft
    ) {
      if (isGeometryEditingFrozen(state.editorState)) {
        store.dispatch({ type: "editor/interaction/end", pointerId: event.pointerId });
        syncEditorChrome();
        return;
      }
      const worldPoint = screenToWorld(state.editorState.camera, point.x, point.y);
      store.dispatch({
        type: "editor/interaction/drawRectMove",
        pointerId: event.pointerId,
        screenX: event.clientX,
        screenY: event.clientY,
        currentWorldX: worldPoint.x,
        currentWorldY: worldPoint.y
      });
      return;
    }

    if (
      state.editorState.interaction.mode === "calibratingScale" &&
      state.editorState.interaction.pointerId === event.pointerId &&
      state.editorState.interaction.calibrationDraft
    ) {
      const worldPoint = screenToWorld(state.editorState.camera, point.x, point.y);
      store.dispatch({
        type: "editor/interaction/calibrationMove",
        pointerId: event.pointerId,
        screenX: event.clientX,
        screenY: event.clientY,
        currentWorldX: worldPoint.x,
        currentWorldY: worldPoint.y
      });
      return;
    }

    if (
      state.editorState.interaction.mode === "resizingRect" &&
      state.editorState.interaction.pointerId === event.pointerId &&
      state.editorState.interaction.resizeRectangle
    ) {
      if (isGeometryEditingFrozen(state.editorState)) {
        store.dispatch({ type: "editor/interaction/end", pointerId: event.pointerId });
        syncEditorChrome();
        return;
      }
      const worldPoint = screenToWorld(state.editorState.camera, point.x, point.y);
      const resizeState = state.editorState.interaction.resizeRectangle;
      if (resizeState.seamSlide) {
        const seamSlideUpdates = deriveInternalSeamSlideUpdates(resizeState.seamSlide, worldPoint, {
          minSize: MIN_RECT_SIZE
        });
        if (seamSlideUpdates.length > 0) {
          applyRectangleGeometryUpdates(state.plan, seamSlideUpdates, {
            enforceRoomConnectivity: true
          });
        }
        store.dispatch({
          type: "editor/interaction/resizeMove",
          pointerId: event.pointerId,
          screenX: event.clientX,
          screenY: event.clientY
        });
        return;
      }
      const nextRect = resizeRectangleFromHandle(
        resizeState.snapshot,
        resizeState.handleName,
        worldPoint,
        { minSize: MIN_RECT_SIZE }
      );
      const resizeRectangleEntity = state.plan.entities.rectangles.find(
        (rectangle) => rectangle.id === resizeState.rectangleId
      );
      let snappedRect = nextRect;
      if (resizeRectangleEntity) {
        const wallWorld = getRectangleWallWorld(resizeRectangleEntity, state.plan.scale?.metersPerWorldUnit);
        const nextShellRect = interiorRectToOuterRect(nextRect, wallWorld);
        if (nextShellRect) {
          const outerMinSize = MIN_RECT_SIZE + Math.max(
            wallWorld.left + wallWorld.right,
            wallWorld.top + wallWorld.bottom
          );
          const snappedShellRect = snapResizedRectangle(
            nextShellRect,
            resizeState.handleName,
            buildPlanShellRectangles(state.plan),
            {
              excludeRectangleId: resizeState.rectangleId,
              toleranceWorld: SNAP_TOLERANCE_PX / state.editorState.camera.zoom,
              minSize: outerMinSize
            }
          ).rectangle;

          const snappedInteriorRect = outerRectToInteriorRect(snappedShellRect, wallWorld);
          if (snappedInteriorRect) {
            snappedRect = snappedInteriorRect;
          }
        }
      }

      applyRectangleGeometryUpdates(
        state.plan,
        [{
          id: resizeState.rectangleId,
          x: snappedRect.x,
          y: snappedRect.y,
          w: snappedRect.w,
          h: snappedRect.h
        }],
        { enforceRoomConnectivity: true }
      );
      store.dispatch({
        type: "editor/interaction/resizeMove",
        pointerId: event.pointerId,
        screenX: event.clientX,
        screenY: event.clientY
      });
    }
  };

  const onPointerUp = (event) => {
    const state = store.getState();
    if (
      state.editorState.interaction.mode === "calibratingScale" &&
      state.editorState.interaction.pointerId === event.pointerId &&
      state.editorState.interaction.calibrationDraft
    ) {
      commitScaleCalibrationDraft(state.editorState.interaction.calibrationDraft, state.plan.scale);
    }

    if (
      state.editorState.interaction.mode === "drawingRect" &&
      state.editorState.interaction.pointerId === event.pointerId &&
      state.editorState.interaction.drawRectDraft
    ) {
      const draft = state.editorState.interaction.drawRectDraft;
      const nextRect = normalizeRectangleFromPoints(draft.startWorld, draft.currentWorld);
      if (rectangleMeetsMinimumSize(nextRect, MIN_RECT_SIZE)) {
        const quantizationWorld = getDragQuantizationWorld(state.plan.scale?.metersPerWorldUnit);
        const quantizedRect = quantizeRectangleGeometry(nextRect, quantizationWorld);
        const rectangleId = `rect_user_${nextUserRectangleId++}`;
        store.dispatch({
          type: "plan/rectangles/create",
          rectangleId,
          x: quantizedRect.x,
          y: quantizedRect.y,
          w: quantizedRect.w,
          h: quantizedRect.h
        });
        store.dispatch({
          type: "editor/selection/set",
          rectangleId
        });
        syncRoomSelectionFromRectangle({ id: rectangleId, roomId: null });
      }
    }

    store.dispatch({
      type: "editor/interaction/end",
      pointerId: event.pointerId
    });
    syncEditorChrome();
  };

  const onPointerCancel = (event) => {
    onPointerUp(event);
  };

  const onPointerLeave = () => {
    pointerHover.active = false;
  };

  const onWheel = (event) => {
    event.preventDefault();
    const point = toCanvasLocalPoint(canvas, event.clientX, event.clientY);
    store.dispatch({
      type: "editor/camera/zoomAtScreenPoint",
      screenX: point.x,
      screenY: point.y,
      deltaY: event.deltaY
    });
  };

  const onDoubleClick = (event) => {
    if (event.button !== 0) {
      return;
    }
    const state = store.getState();
    if (state.editorState.tool !== "navigate") {
      return;
    }

    const point = toCanvasLocalPoint(canvas, event.clientX, event.clientY);
    const worldPoint = screenToWorld(state.editorState.camera, point.x, point.y);
    const fixtureHit = hitTestLightingFixtures(state.plan, worldPoint, state.editorState.camera.zoom);
    if (!fixtureHit || fixtureHit.fixture.kind !== "switch") {
      return;
    }

    store.dispatch({ type: "editor/selection/clear" });
    store.dispatch({ type: "editor/lightingSelection/setFixture", fixtureId: fixtureHit.fixture.id });
    store.dispatch({ type: "editor/openingSelection/clear" });
    store.dispatch({ type: "editor/lightingPreview/toggleSwitch", switchId: fixtureHit.fixture.id });
    syncEditorChrome();
  };

  canvas.addEventListener("pointerdown", onPointerDown);
  canvas.addEventListener("pointermove", onPointerMove);
  canvas.addEventListener("pointerup", onPointerUp);
  canvas.addEventListener("pointercancel", onPointerCancel);
  canvas.addEventListener("pointerleave", onPointerLeave);
  canvas.addEventListener("wheel", onWheel, { passive: false });
  canvas.addEventListener("dblclick", onDoubleClick);

  if (controls.resetViewButton) {
    controls.resetViewButton.addEventListener("click", () => {
      store.dispatch({ type: "editor/camera/reset" });
    });
  }

  if (controls.resetPlanButton) {
    controls.resetPlanButton.addEventListener("click", () => {
      const nextPlan = createEmptyPlan();
      store.dispatch({ type: "plan/replace", plan: nextPlan });
      store.dispatch({ type: "editor/selection/clear" });
      store.dispatch({ type: "editor/lightingSelection/clearFixture" });
      store.dispatch({ type: "editor/openingSelection/clear" });
      store.dispatch({ type: "editor/lightingLink/clearSwitch" });
      store.dispatch({ type: "editor/lightingPreview/clear" });
      store.dispatch({ type: "editor/interaction/end", pointerId: null });
      nextUserRectangleId = deriveNextUserRectangleId(nextPlan);
      nextUserFixtureId = deriveNextUserFixtureId(nextPlan);
      nextUserOpeningId = deriveNextUserOpeningId(nextPlan);
    });
  }

  if (controls.seedDebugButton) {
    controls.seedDebugButton.addEventListener("click", () => {
      store.dispatch({ type: "plan/debugSeedRectangles", force: false });
    });
  }

  if (controls.toolNavigateButton) {
    controls.toolNavigateButton.addEventListener("click", () => {
      store.dispatch({ type: "editor/tool/set", tool: "navigate" });
    });
  }

  if (controls.toolDrawRectButton) {
    controls.toolDrawRectButton.addEventListener("click", () => {
      store.dispatch({ type: "editor/tool/set", tool: "drawRect" });
    });
  }

  if (controls.toolCalibrateScaleButton) {
    controls.toolCalibrateScaleButton.addEventListener("click", () => {
      store.dispatch({ type: "editor/tool/set", tool: "calibrateScale" });
    });
  }

  if (controls.calibrateScaleByAreaButton) {
    controls.calibrateScaleByAreaButton.addEventListener("click", () => {
      calibrateScaleByActiveRoomArea();
    });
  }

  if (controls.toolMergeRoomButton) {
    controls.toolMergeRoomButton.addEventListener("click", () => {
      store.dispatch({ type: "editor/tool/set", tool: "mergeRoom" });
    });
  }

  if (controls.geometryFreezeToggleButton) {
    controls.geometryFreezeToggleButton.addEventListener("click", () => {
      store.dispatch({ type: "editor/locks/toggleGeometryFreeze" });
      const nextState = store.getState().editorState;
      if (isGeometryEditingFrozen(nextState)) {
        if (
          nextState.tool === "drawRect" ||
          nextState.tool === "mergeRoom" ||
          nextState.tool === "placeDoor" ||
          nextState.tool === "placeWindow"
        ) {
          store.dispatch({ type: "editor/tool/set", tool: "navigate" });
        }
        store.dispatch({ type: "editor/interaction/end", pointerId: null });
        store.dispatch({ type: "editor/merge/clear" });
      }
      syncEditorChrome();
    });
  }

  if (controls.normalizeCmGridButton) {
    controls.normalizeCmGridButton.addEventListener("click", () => {
      normalizeAllRectanglesToCentimeterGrid();
    });
  }

  if (controls.toolPlaceSwitchButton) {
    controls.toolPlaceSwitchButton.addEventListener("click", () => {
      store.dispatch({ type: "editor/tool/set", tool: "placeSwitch" });
    });
  }

  if (controls.toolPlaceLampButton) {
    controls.toolPlaceLampButton.addEventListener("click", () => {
      store.dispatch({ type: "editor/tool/set", tool: "placeLamp" });
    });
  }

  if (controls.toolPlaceDoorButton) {
    controls.toolPlaceDoorButton.addEventListener("click", () => {
      store.dispatch({ type: "editor/tool/set", tool: "placeDoor" });
    });
  }

  if (controls.toolPlaceWindowButton) {
    controls.toolPlaceWindowButton.addEventListener("click", () => {
      store.dispatch({ type: "editor/tool/set", tool: "placeWindow" });
    });
  }

  if (controls.toolLinkLightingButton) {
    controls.toolLinkLightingButton.addEventListener("click", () => {
      store.dispatch({ type: "editor/tool/set", tool: "linkLighting" });
    });
  }

  if (controls.estimateToggleButton) {
    controls.estimateToggleButton.addEventListener("click", () => {
      estimatePanelOpen = !estimatePanelOpen;
      syncEditorChrome();
    });
  }

  if (controls.estimateGroupModeToggleButton) {
    controls.estimateGroupModeToggleButton.addEventListener("click", () => {
      const snapshot = store.getState();
      const quote = getQuoteModel(snapshot.plan);
      const nextMode = quote.groupMode === "job" ? "room" : "job";
      store.dispatch({
        type: "plan/quote/setGroupMode",
        groupMode: nextMode
      });
      syncEditorChrome();
    });
  }

  if (controls.roomHighlightToggleButton) {
    controls.roomHighlightToggleButton.addEventListener("click", () => {
      store.dispatch({ type: "plan/view/toggleRoomHighlighting" });
      syncEditorChrome();
    });
  }

  if (controls.wallsBlackToggleButton) {
    controls.wallsBlackToggleButton.addEventListener("click", () => {
      store.dispatch({ type: "plan/view/toggleWallsBlack" });
      syncEditorChrome();
    });
  }

  if (controls.estimatePrintButton) {
    controls.estimatePrintButton.addEventListener("click", () => {
      window.print();
    });
  }

  if (controls.estimateBodyElement) {
    controls.estimateBodyElement.addEventListener("click", (event) => {
      const target = event.target;
      if (!(target instanceof HTMLElement)) {
        return;
      }
      const action = target.getAttribute("data-quote-action");
      if (!action) {
        return;
      }
      event.preventDefault();
      if (action === "add-flooring-type") {
        const nameInput = controls.estimateBodyElement.querySelector("[data-quote-input='new-flooring-name']");
        const name = nameInput instanceof HTMLInputElement ? nameInput.value.trim() : "";
        if (!name) {
          return;
        }
        const snapshot = store.getState();
        const quote = getQuoteModel(snapshot.plan);
        const id = generateQuoteCatalogId("floor", name, quote.catalog.flooringTypes);
        const selectedFlooringTypeId = getEstimateSelectValue(controls.estimateBodyElement, "flooringTypeId");
        const selectedType = resolveQuoteCatalogItemById(
          quote.catalog.flooringTypes,
          selectedFlooringTypeId,
          quote.defaults.flooringTypeId
        );
        store.dispatch({
          type: "plan/quote/upsertCatalogItem",
          catalogKey: "flooringTypes",
          item: {
            id,
            name,
            materialPerM2: selectedType?.materialPerM2 ?? 0,
            laborPerM2: selectedType?.laborPerM2 ?? 0
          }
        });
        store.dispatch({
          type: "plan/quote/setDefault",
          key: "flooringTypeId",
          value: id
        });
        if (nameInput instanceof HTMLInputElement) {
          nameInput.value = "";
        }
        syncEditorChrome();
        return;
      }

      if (action === "add-painting-type") {
        const nameInput = controls.estimateBodyElement.querySelector("[data-quote-input='new-painting-name']");
        const name = nameInput instanceof HTMLInputElement ? nameInput.value.trim() : "";
        if (!name) {
          return;
        }
        const snapshot = store.getState();
        const quote = getQuoteModel(snapshot.plan);
        const id = generateQuoteCatalogId("paint", name, quote.catalog.paintingTypes);
        const selectedPaintingTypeId = getEstimateSelectValue(controls.estimateBodyElement, "paintingTypeId");
        const selectedType = resolveQuoteCatalogItemById(
          quote.catalog.paintingTypes,
          selectedPaintingTypeId,
          quote.defaults.paintingTypeId
        );
        store.dispatch({
          type: "plan/quote/upsertCatalogItem",
          catalogKey: "paintingTypes",
          item: {
            id,
            name,
            materialPerM2: selectedType?.materialPerM2 ?? 0,
            laborPerM2: selectedType?.laborPerM2 ?? 0
          }
        });
        store.dispatch({
          type: "plan/quote/setDefault",
          key: "paintingTypeId",
          value: id
        });
        if (nameInput instanceof HTMLInputElement) {
          nameInput.value = "";
        }
        syncEditorChrome();
        return;
      }

      const snapshot = store.getState();
      const quote = getQuoteModel(snapshot.plan);
      if (action === "apply-flooring-rates") {
        applyAreaTypeRatesFromEstimateControls({
          catalogKey: "flooringTypes",
          selectInputKey: "flooringTypeId",
          materialInputKey: "flooring-materialPerM2",
          laborInputKey: "flooring-laborPerM2",
          defaultKey: "flooringTypeId",
          quote
        });
        return;
      }
      if (action === "apply-painting-rates") {
        applyAreaTypeRatesFromEstimateControls({
          catalogKey: "paintingTypes",
          selectInputKey: "paintingTypeId",
          materialInputKey: "painting-materialPerM2",
          laborInputKey: "painting-laborPerM2",
          defaultKey: "paintingTypeId",
          quote
        });
        return;
      }
      if (action === "apply-baseboard-rates") {
        const selectedProfileId = getEstimateSelectValue(controls.estimateBodyElement, "baseboardProfileId");
        const selectedProfile = resolveQuoteCatalogItemById(
          quote.catalog.baseboardProfiles,
          selectedProfileId,
          quote.defaults.baseboardProfileId
        );
        if (!selectedProfile) {
          return;
        }
        const materialPerM = readEstimateControlNumber(controls.estimateBodyElement, "baseboard-materialPerM");
        const laborPerM = readEstimateControlNumber(controls.estimateBodyElement, "baseboard-laborPerM");
        if (materialPerM == null || laborPerM == null) {
          return;
        }
        store.dispatch({
          type: "plan/quote/upsertCatalogItem",
          catalogKey: "baseboardProfiles",
          item: {
            ...selectedProfile,
            materialPerM,
            laborPerM
          }
        });
        store.dispatch({
          type: "plan/quote/setDefault",
          key: "baseboardProfileId",
          value: selectedProfile.id
        });
        syncEditorChrome();
        return;
      }
      if (action === "apply-unit-prices") {
        applyUnitPriceFromEstimateControls(quote, "switchProducts", "switchProductId", "switch-unitPrice");
        applyUnitPriceFromEstimateControls(quote, "lampProducts", "lampProductId", "lamp-unitPrice");
        applyUnitPriceFromEstimateControls(quote, "doorProducts", "doorProductId", "door-unitPrice");
        syncEditorChrome();
      }
    });

    controls.estimateBodyElement.addEventListener("change", (event) => {
      const target = event.target;
      if (!(target instanceof HTMLSelectElement)) {
        return;
      }
      const inputKey = target.getAttribute("data-quote-input");
      if (!inputKey) {
        return;
      }
      const snapshot = store.getState();
      const quote = getQuoteModel(snapshot.plan);
      if (inputKey === "flooringTypeId") {
        const selectedType = resolveQuoteCatalogItemById(
          quote.catalog.flooringTypes,
          normalizeRectangleIdForUi(target.value),
          quote.defaults.flooringTypeId
        );
        syncEstimateRateInputsForAreaType(controls.estimateBodyElement, "flooring", selectedType);
        return;
      }
      if (inputKey === "paintingTypeId") {
        const selectedType = resolveQuoteCatalogItemById(
          quote.catalog.paintingTypes,
          normalizeRectangleIdForUi(target.value),
          quote.defaults.paintingTypeId
        );
        syncEstimateRateInputsForAreaType(controls.estimateBodyElement, "painting", selectedType);
        return;
      }
      if (inputKey === "baseboardProfileId") {
        const selectedProfile = resolveQuoteCatalogItemById(
          quote.catalog.baseboardProfiles,
          normalizeRectangleIdForUi(target.value),
          quote.defaults.baseboardProfileId
        );
        syncEstimateRateInputsForBaseboard(controls.estimateBodyElement, selectedProfile);
      }
    });
  }

  if (controls.lightingProductSelect) {
    controls.lightingProductSelect.addEventListener("change", () => {
      const snapshot = store.getState();
      const selectedFixture = getSelectedLightingFixture(snapshot.plan, snapshot.editorState);
      if (!selectedFixture) {
        return;
      }
      const nextProductId = normalizeRectangleIdForUi(controls.lightingProductSelect.value);
      store.dispatch({
        type: "plan/lighting/setFixtureProduct",
        fixtureId: selectedFixture.id,
        productId: nextProductId
      });
      syncEditorChrome();
    });
  }

  if (controls.openingDoorProductSelect) {
    controls.openingDoorProductSelect.addEventListener("change", () => {
      const snapshot = store.getState();
      const selectedOpening = getSelectedOpening(snapshot.plan, snapshot.editorState);
      if (!selectedOpening || selectedOpening.kind !== "door") {
        return;
      }
      const nextProductId = normalizeRectangleIdForUi(controls.openingDoorProductSelect.value);
      store.dispatch({
        type: "plan/openings/setProduct",
        openingId: selectedOpening.id,
        productId: nextProductId
      });
      syncEditorChrome();
    });
  }

  if (controls.baseboardDebugToggleButton) {
    controls.baseboardDebugToggleButton.addEventListener("click", () => {
      store.dispatch({ type: "editor/debug/toggleBaseboardOverlay" });
    });
  }

  if (controls.baseboardConflictToggleButton) {
    controls.baseboardConflictToggleButton.addEventListener("click", () => {
      store.dispatch({ type: "editor/debug/toggleBaseboardConflictOverlay" });
    });
  }

  if (controls.deleteSelectedButton) {
    controls.deleteSelectedButton.addEventListener("click", () => {
      deleteSelectedRectangle();
    });
  }

  if (controls.deleteSelectedOpeningButton) {
    controls.deleteSelectedOpeningButton.addEventListener("click", () => {
      deleteSelectedOpening();
    });
  }

  if (controls.deleteSelectedFixtureButton) {
    controls.deleteSelectedFixtureButton.addEventListener("click", () => {
      deleteSelectedLightingFixture();
    });
  }

  if (controls.unplugSelectedFixtureButton) {
    controls.unplugSelectedFixtureButton.addEventListener("click", () => {
      unplugSelectedLightingFixture();
    });
  }

  if (controls.clearLightingLinkSourceButton) {
    controls.clearLightingLinkSourceButton.addEventListener("click", () => {
      store.dispatch({ type: "editor/lightingLink/clearSwitch" });
      syncEditorChrome();
    });
  }

  if (controls.rectangleKindToggleButton) {
    controls.rectangleKindToggleButton.addEventListener("click", () => {
      toggleSelectedRectangleKind();
    });
  }

  if (controls.wallTopDecreaseButton) {
    controls.wallTopDecreaseButton.addEventListener("click", () => {
      adjustSelectedRectangleWallCm("top", -WALL_CM_STEP);
    });
  }
  if (controls.wallTopIncreaseButton) {
    controls.wallTopIncreaseButton.addEventListener("click", () => {
      adjustSelectedRectangleWallCm("top", WALL_CM_STEP);
    });
  }
  if (controls.wallRightDecreaseButton) {
    controls.wallRightDecreaseButton.addEventListener("click", () => {
      adjustSelectedRectangleWallCm("right", -WALL_CM_STEP);
    });
  }
  if (controls.wallRightIncreaseButton) {
    controls.wallRightIncreaseButton.addEventListener("click", () => {
      adjustSelectedRectangleWallCm("right", WALL_CM_STEP);
    });
  }
  if (controls.wallBottomDecreaseButton) {
    controls.wallBottomDecreaseButton.addEventListener("click", () => {
      adjustSelectedRectangleWallCm("bottom", -WALL_CM_STEP);
    });
  }
  if (controls.wallBottomIncreaseButton) {
    controls.wallBottomIncreaseButton.addEventListener("click", () => {
      adjustSelectedRectangleWallCm("bottom", WALL_CM_STEP);
    });
  }
  if (controls.wallLeftDecreaseButton) {
    controls.wallLeftDecreaseButton.addEventListener("click", () => {
      adjustSelectedRectangleWallCm("left", -WALL_CM_STEP);
    });
  }
  if (controls.wallLeftIncreaseButton) {
    controls.wallLeftIncreaseButton.addEventListener("click", () => {
      adjustSelectedRectangleWallCm("left", WALL_CM_STEP);
    });
  }

  if (controls.roomAssignButton) {
    controls.roomAssignButton.addEventListener("click", () => {
      assignSelectedRectangleRoomTag();
    });
  }

  if (controls.roomClearButton) {
    controls.roomClearButton.addEventListener("click", () => {
      clearSelectedRectangleRoomTag();
    });
  }

  if (controls.wallHeightApplyButton) {
    controls.wallHeightApplyButton.addEventListener("click", () => {
      applyWallHeightFromControl();
    });
  }
  if (controls.wallHeightInput) {
    controls.wallHeightInput.addEventListener("keydown", (event) => {
      if (event.key !== "Enter") {
        return;
      }
      event.preventDefault();
      applyWallHeightFromControl();
    });
    controls.wallHeightInput.addEventListener("blur", () => {
      syncPaintingControls(store.getState().plan);
    });
  }

  if (controls.roomMergeCompleteButton) {
    controls.roomMergeCompleteButton.addEventListener("click", () => {
      completeMergeSelection();
    });
  }

  if (controls.roomMergeCancelButton) {
    controls.roomMergeCancelButton.addEventListener("click", () => {
      cancelMergeSelection();
    });
  }

  if (controls.roomDissolveButton) {
    controls.roomDissolveButton.addEventListener("click", () => {
      dissolveSelectedRectangleRoom();
    });
  }

  if (controls.roomInternalSlideToggleButton) {
    controls.roomInternalSlideToggleButton.addEventListener("click", () => {
      store.dispatch({ type: "editor/merge/toggleInternalAdjust" });
    });
  }

  if (controls.roomNameInput) {
    controls.roomNameInput.addEventListener("keydown", (event) => {
      if (event.key !== "Enter") {
        return;
      }
      event.preventDefault();
      assignSelectedRectangleRoomTag();
    });
  }

  if (controls.roomListElement) {
    controls.roomListElement.addEventListener("click", (event) => {
      const target = event.target;
      if (!(target instanceof HTMLElement)) {
        return;
      }
      const summary = target.closest(".room-tree-summary[data-room-item-id]");
      if (!(summary instanceof HTMLElement)) {
        return;
      }
      const roomId = summary.dataset.roomItemId;
      if (!roomId) {
        return;
      }
      if (target.closest(".room-tree-fold[data-room-item-id]")) {
        if (roomTreeOpenIds.has(roomId)) {
          roomTreeOpenIds.delete(roomId);
        } else {
          roomTreeOpenIds.add(roomId);
        }
      }
      event.preventDefault();
      activateRoomFromSidebar(roomId, { center: false });
    });

    controls.roomListElement.addEventListener("dblclick", (event) => {
      const target = event.target;
      if (!(target instanceof HTMLElement)) {
        return;
      }
      const summary = target.closest(".room-tree-summary[data-room-item-id]");
      if (!(summary instanceof HTMLElement)) {
        return;
      }
      const roomId = summary.dataset.roomItemId;
      activateRoomFromSidebar(roomId, { center: true });
    });

    controls.roomListElement.addEventListener("change", (event) => {
      const target = event.target;
      if (!(target instanceof HTMLElement)) {
        return;
      }
      const roomEntryId = normalizeRectangleIdForUi(
        target.getAttribute("data-room-quote-room-id")
      );
      if (!roomEntryId) {
        return;
      }

      if (target instanceof HTMLInputElement && target.matches("[data-room-quote-field='includeBaseboard']")) {
        store.dispatch({
          type: "plan/quote/setRoomConfig",
          roomEntryId,
          patch: {
            includeBaseboard: target.checked
          }
        });
        syncEditorChrome();
        return;
      }

      if (target instanceof HTMLSelectElement && target.matches("[data-room-quote-field='flooringTypeId']")) {
        const flooringTypeId = normalizeRectangleIdForUi(target.value);
        store.dispatch({
          type: "plan/quote/setRoomConfig",
          roomEntryId,
          patch: {
            flooringTypeId
          }
        });
        syncEditorChrome();
        return;
      }

      if (target instanceof HTMLSelectElement && target.matches("[data-room-quote-field='paintingTypeId']")) {
        const paintingTypeId = normalizeRectangleIdForUi(target.value);
        store.dispatch({
          type: "plan/quote/setRoomConfig",
          roomEntryId,
          patch: {
            paintingTypeId
          }
        });
        syncEditorChrome();
      }
    });
  }

  if (controls.backgroundOpacityDownButton) {
    controls.backgroundOpacityDownButton.addEventListener("click", () => {
      const { plan } = store.getState();
      store.dispatch({
        type: "plan/background/setOpacity",
        opacity: plan.background.opacity - BACKGROUND_OPACITY_STEP
      });
    });
  }

  if (controls.backgroundOpacityUpButton) {
    controls.backgroundOpacityUpButton.addEventListener("click", () => {
      const { plan } = store.getState();
      store.dispatch({
        type: "plan/background/setOpacity",
        opacity: plan.background.opacity + BACKGROUND_OPACITY_STEP
      });
    });
  }

  if (controls.backgroundMoveLeftButton) {
    controls.backgroundMoveLeftButton.addEventListener("click", () => {
      store.dispatch({ type: "plan/background/nudge", dx: -BACKGROUND_NUDGE_STEP, dy: 0 });
    });
  }

  if (controls.backgroundMoveRightButton) {
    controls.backgroundMoveRightButton.addEventListener("click", () => {
      store.dispatch({ type: "plan/background/nudge", dx: BACKGROUND_NUDGE_STEP, dy: 0 });
    });
  }

  if (controls.backgroundMoveUpButton) {
    controls.backgroundMoveUpButton.addEventListener("click", () => {
      store.dispatch({ type: "plan/background/nudge", dx: 0, dy: -BACKGROUND_NUDGE_STEP });
    });
  }

  if (controls.backgroundMoveDownButton) {
    controls.backgroundMoveDownButton.addEventListener("click", () => {
      store.dispatch({ type: "plan/background/nudge", dx: 0, dy: BACKGROUND_NUDGE_STEP });
    });
  }

  if (controls.backgroundScaleDownButton) {
    controls.backgroundScaleDownButton.addEventListener("click", () => {
      store.dispatch({ type: "plan/background/scaleUniform", factor: BACKGROUND_SCALE_DOWN });
    });
  }

  if (controls.backgroundScaleUpButton) {
    controls.backgroundScaleUpButton.addEventListener("click", () => {
      store.dispatch({ type: "plan/background/scaleUniform", factor: BACKGROUND_SCALE_UP });
    });
  }

  const onImportJsonFileChange = async (event) => {
    const input = event.currentTarget;
    if (!(input instanceof HTMLInputElement)) {
      return;
    }

    const file = input.files && input.files[0] ? input.files[0] : null;
    if (!file) {
      return;
    }

    setFileTransferStatus({
      phase: "importing",
      lastAction: "import",
      message: `Importing ${file.name}...`
    });

    try {
      const text = await file.text();
      if (destroyed) {
        return;
      }

      const importedPlan = parseImportedPlanJsonText(text);
      store.dispatch({ type: "plan/replace", plan: importedPlan });
      store.dispatch({ type: "editor/selection/clear" });
      store.dispatch({ type: "editor/lightingSelection/clearFixture" });
      store.dispatch({ type: "editor/openingSelection/clear" });
      store.dispatch({ type: "editor/lightingLink/clearSwitch" });
      store.dispatch({ type: "editor/lightingPreview/clear" });
      store.dispatch({ type: "editor/interaction/end", pointerId: null });
      store.dispatch({ type: "editor/tool/set", tool: "navigate" });
      nextUserRectangleId = deriveNextUserRectangleId(importedPlan);
      nextUserFixtureId = deriveNextUserFixtureId(importedPlan);
      nextUserOpeningId = deriveNextUserOpeningId(importedPlan);
      autosaveController.flushNow("import");

      setFileTransferStatus({
        phase: "imported",
        lastAction: "import",
        message: `Imported ${file.name} (${importedPlan.entities.rectangles.length} rects)`
      });
    } catch (error) {
      console.warn("Failed to import plan JSON.", error);
      setFileTransferStatus({
        phase: "error",
        lastAction: "import",
        message: error instanceof Error ? error.message : String(error)
      });
    } finally {
      input.value = "";
    }
  };

  if (controls.exportJsonButton) {
    controls.exportJsonButton.addEventListener("click", () => {
      exportCurrentPlanJson();
    });
  }

  if (controls.importJsonButton && controls.importJsonFileInput) {
    controls.importJsonButton.addEventListener("click", () => {
      controls.importJsonFileInput.value = "";
      controls.importJsonFileInput.click();
    });
    controls.importJsonFileInput.addEventListener("change", onImportJsonFileChange);
  }

  const onWindowKeyDown = (event) => {
    if (shouldIgnoreGlobalKeyDown(event)) {
      return;
    }

    if (event.key !== "Delete" && event.key !== "Backspace") {
      return;
    }

    event.preventDefault();

    const didDelete = deleteSelectedRectangle();
    if (didDelete) {
      return;
    }
    const didDeleteOpening = deleteSelectedOpening();
    if (didDeleteOpening) {
      return;
    }
    deleteSelectedLightingFixture();
  };

  window.addEventListener("keydown", onWindowKeyDown);

  store.subscribe(() => {
    syncEditorChrome();
  });

  resize();
  syncEditorChrome();
  startRenderLoop();

  return {
    getState: () => store.getState(),
    destroy
  };

  function startRenderLoop() {
    if (destroyed) return;
    const tick = (timestamp) => {
      if (destroyed) return;
      renderFrame(timestamp);
      rafId = window.requestAnimationFrame(tick);
    };
    rafId = window.requestAnimationFrame(tick);
  }

  function renderFrame(timestamp) {
    const { plan, editorState } = store.getState();
    const { viewport, camera } = editorState;
    const cssWidth = viewport.cssWidth;
    const cssHeight = viewport.cssHeight;
    const dpr = viewport.dpr;

    const validation = getBasicValidationResult(plan);
    const baseboard = getBaseboardResult(plan);
    const lockedSeamSides = getLockedSeamSides(plan);
    const roomEntries = deriveSidebarRooms(plan);
    const activeRoomId = deriveEffectiveActiveRoomId(plan, editorState, roomEntries);

    ensureBackgroundImageLoaded(plan.background);

    context.setTransform(dpr, 0, 0, dpr, 0, 0);
    context.clearRect(0, 0, cssWidth, cssHeight);
    context.fillStyle = "#ffffff";
    context.fillRect(0, 0, cssWidth, cssHeight);

    drawWorld(
      context,
      plan,
      editorState,
      validation,
      cssWidth,
      cssHeight,
      dpr,
      baseboard,
      lockedSeamSides,
      activeRoomId,
      timestamp
    );
    drawScreenOverlay(context, editorState, plan, validation, baseboard, pointerHover, cssWidth, cssHeight, timestamp);
    updateUiReadouts(editorState, plan, validation, baseboard, timestamp);
  }

  function drawWorld(
    ctx,
    plan,
    editorState,
    validation,
    cssWidth,
    cssHeight,
    dpr,
    baseboard,
    lockedSeamSides,
    activeRoomId,
    timestamp
  ) {
    const { camera, selection } = editorState;
    const showBaseboardOverlay = isBaseboardOverlayEnabled(editorState);
    const showBaseboardConflictOverlay = isBaseboardConflictOverlayEnabled(editorState);
    const baseboardConflicts = (showBaseboardOverlay || showBaseboardConflictOverlay)
      ? getBaseboardConflictResult(plan, baseboard)
      : null;
    ctx.save();
    ctx.setTransform(
      dpr * camera.zoom,
      0,
      0,
      dpr * camera.zoom,
      -(camera.x * camera.zoom) * dpr,
      -(camera.y * camera.zoom) * dpr
    );

    drawBackgroundFrame(ctx, plan, backgroundImageState);
    drawGrid(ctx, camera, cssWidth, cssHeight);
    drawDebugRectangles(
      ctx,
      plan,
      selection.rectangleId,
      camera,
      editorState.mergeSelection?.rectangleIds,
      activeRoomId,
      lockedSeamSides
    );
    drawOpenings(ctx, plan, editorState, camera);
    drawLightingLinks(ctx, plan, editorState, camera);
    drawLightingFixtures(ctx, plan, editorState, camera);
    if (showBaseboardOverlay) {
      drawBaseboardDebugSegments(ctx, baseboard, camera);
    }
    if (showBaseboardConflictOverlay) {
      drawBaseboardConflictSegments(ctx, baseboardConflicts, camera);
    }
    drawValidationOverlapFlash(ctx, plan, validation, camera, timestamp);
    drawSelectedResizeHandles(ctx, plan, editorState, lockedSeamSides);
    drawDraftRectangle(ctx, editorState, camera);
    drawScaleReferenceLine(ctx, plan, camera);
    drawCalibrationDraftLine(ctx, editorState, camera);
    drawWorldAxes(ctx, camera, cssWidth, cssHeight);

    ctx.restore();
  }

  function drawScreenOverlay(ctx, editorState, plan, validation, baseboard, hover, cssWidth, cssHeight, timestamp) {
    const { camera } = editorState;
    const showBaseboardOverlay = isBaseboardOverlayEnabled(editorState);
    const showBaseboardConflictOverlay = isBaseboardConflictOverlayEnabled(editorState);
    const baseboardConflicts = getBaseboardConflictResult(plan, baseboard);
    const selectedRectangle = getSelectedRectangle(plan, editorState);
    const originScreen = worldToScreen(camera, 0, 0);

    if (
      originScreen.x >= -24 &&
      originScreen.x <= cssWidth + 24 &&
      originScreen.y >= -24 &&
      originScreen.y <= cssHeight + 24
    ) {
      ctx.save();
      ctx.strokeStyle = "rgba(200, 40, 40, 0.65)";
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(originScreen.x - 8, originScreen.y);
      ctx.lineTo(originScreen.x + 8, originScreen.y);
      ctx.moveTo(originScreen.x, originScreen.y - 8);
      ctx.lineTo(originScreen.x, originScreen.y + 8);
      ctx.stroke();
      ctx.restore();
    }

    ctx.save();
    ctx.fillStyle = "rgba(255,255,255,0.92)";
    ctx.strokeStyle = "rgba(0,0,0,0.15)";
    ctx.lineWidth = 1;
    ctx.fillRect(12, 12, 470, 172);
    ctx.strokeRect(12, 12, 470, 172);

    ctx.fillStyle = "#1f1f1f";
    ctx.font = "12px Georgia, serif";
    ctx.textBaseline = "top";
    ctx.fillText(`Zoom: ${camera.zoom.toFixed(2)}x`, 20, 18);
    ctx.fillText(`Camera: ${camera.x.toFixed(1)}, ${camera.y.toFixed(1)}`, 20, 34);
    ctx.fillText(`Rects: ${plan.entities.rectangles.length}`, 20, 50);
    ctx.fillText(`Selected: ${editorState.selection.rectangleId ?? "none"}`, 20, 66);
    ctx.fillText(`Tool: ${editorState.tool}`, 20, 82);
    ctx.fillText(`Mode: ${editorState.interaction.mode}`, 20, 98);
    const scaleLabel = formatScaleShort(plan.scale);
    ctx.fillText(`Scale: ${scaleLabel}`, 180, 18);
    ctx.fillText(`Sel world: ${formatSelectedRectangleDimensionsWorld(selectedRectangle)}`, 180, 34);
    ctx.fillText(`Sel metric: ${formatSelectedRectangleDimensionsMetric(selectedRectangle, plan.scale)}`, 180, 50);
    ctx.fillText(`Validation: ${formatValidationSummaryDebug(validation)}`, 180, 66);
    ctx.fillText(`${formatValidationPrimaryMessage(validation)}`, 180, 82);
    ctx.fillText(`File IO: ${formatFileTransferStatusShort(fileTransferStatus)}`, 180, 98);
    ctx.fillText(`Baseboard: ${formatBaseboardSummaryDebug(baseboard, showBaseboardOverlay)}`, 20, 114);
    ctx.fillText(`Overlap flash: ${formatValidationOverlapFlashDebug(validation, timestamp)}`, 20, 130);
    ctx.fillText(`BB conflicts: ${formatBaseboardConflictSummaryOverlay(baseboardConflicts, showBaseboardConflictOverlay)}`, 20, 146);
    ctx.restore();

    drawSelectedRectangleDimensionLabels(ctx, editorState, plan, hover, cssWidth, cssHeight);

    if (hover.active) {
      const world = screenToWorld(camera, hover.screenX, hover.screenY);
      ctx.save();
      ctx.fillStyle = "rgba(31,31,31,0.78)";
      ctx.fillRect(cssWidth - 180, 12, 168, 28);
      ctx.fillStyle = "#fff";
      ctx.font = "12px Georgia, serif";
      ctx.textBaseline = "middle";
      ctx.fillText(`World ${world.x.toFixed(1)}, ${world.y.toFixed(1)}`, cssWidth - 172, 26);
      ctx.restore();
    }
  }

  function updateUiReadouts(editorState, plan, validation, baseboard, timestamp) {
    const showBaseboardOverlay = isBaseboardOverlayEnabled(editorState);
    const showBaseboardConflictOverlay = isBaseboardConflictOverlayEnabled(editorState);
    const baseboardConflicts = getBaseboardConflictResult(plan, baseboard);
    frameCount += 1;
    framesSinceSample += 1;
    const sampleDuration = timestamp - lastFpsSampleMs;
    if (sampleDuration >= 500) {
      fps = (framesSinceSample * 1000) / sampleDuration;
      framesSinceSample = 0;
      lastFpsSampleMs = timestamp;
    }

    if (statusElement) {
      const camera = editorState.camera;
      const selectedRectangle = getSelectedRectangle(plan, editorState);
      const selectedId = editorState.selection.rectangleId ?? "none";
      const tool = editorState.tool;
      const autosaveLabel = formatAutosaveStatusShort(persistenceStatus);
      const backgroundLabel = formatBackgroundShort(plan.background, backgroundImageState);
      const scaleLabel = formatScaleShort(plan.scale);
      const selectedDimsLabel = formatSelectedRectangleDimensionsStatus(selectedRectangle, plan.scale);
      const selectedWallLabel = formatSelectedRectangleWallCmStatus(selectedRectangle);
      const selectedKindLabel = formatSelectedRectangleKindStatus(selectedRectangle);
      const selectedRoomLabel = formatSelectedRectangleRoomTagStatus(selectedRectangle, plan);
      const validationLabel = formatValidationSummaryStatus(validation);
      const closureLabel = formatClosureValidationStatus(validation);
      const overlapFlashLabel = formatValidationOverlapFlashStatus(validation, timestamp);
      const baseboardLabel = formatBaseboardSummaryStatus(baseboard, showBaseboardOverlay);
      const conflictLabel = formatBaseboardConflictSummaryStatus(baseboardConflicts, showBaseboardConflictOverlay);
      const fileIoLabel = formatFileTransferStatusShort(fileTransferStatus);
      const mergeSelectionCount = Array.isArray(editorState.mergeSelection?.rectangleIds)
        ? editorState.mergeSelection.rectangleIds.length
        : 0;
      const internalSlideMode = isInternalSeamSlideAdjustEnabled(editorState) ? "slides:on" : "slides:off";
      const geometryLockMode = isGeometryEditingFrozen(editorState) ? "geom:frozen" : "geom:live";
      const planView = getPlanViewState(plan);
      const viewModeLabel = `view rooms:${planView.roomHighlighting ? "color" : "white"} walls:${planView.wallsBlack ? "black" : "normal"}`;
      const activeRoomId = deriveEffectiveActiveRoomId(plan, editorState);
      const selectedFixture = getSelectedLightingFixture(plan, editorState);
      const selectedOpening = getSelectedOpening(plan, editorState);
      const lightingTotals = computeLightingTotals(plan);
      const quote = getQuoteModel(plan);
      const selectedFixtureLabel = selectedFixture
        ? `${selectedFixture.kind}:${selectedFixture.id}`
        : "none";
      const selectedOpeningLabel = selectedOpening
        ? `${selectedOpening.kind}:${selectedOpening.id}`
        : "none";
      const openingCount = Array.isArray(plan?.entities?.openings) ? plan.entities.openings.length : 0;
      const wallHeightMeters = getPlanWallHeightMeters(plan);
      statusElement.textContent =
        `T-0027/0028/0029 + T-0030/0031/0032 | ${backgroundLabel} | ${scaleLabel} | ${autosaveLabel} | ${validationLabel} | ${closureLabel} | overlap ${overlapFlashLabel} | ${baseboardLabel} | ${conflictLabel} | paint h:${wallHeightMeters.toFixed(2)}m | openings ${openingCount} sel:${selectedOpeningLabel} | lights s:${lightingTotals.switchCount} l:${lightingTotals.lampCount} lk:${lightingTotals.linkCount} sel:${selectedFixtureLabel} | file ${fileIoLabel} | tool ${tool} | pan | wheel zoom | ` +
        `camera ${camera.x.toFixed(1)}, ${camera.y.toFixed(1)} | ` +
        `zoom ${camera.zoom.toFixed(2)}x | merge ${mergeSelectionCount} ${internalSlideMode} | ${geometryLockMode} | ${viewModeLabel} | quote:${quote.groupMode} | active-room ${activeRoomId ?? "none"} | ` +
        `rects ${plan.entities.rectangles.length} | selected ${selectedId}${selectedKindLabel ? ` (${selectedKindLabel})` : ""}${selectedDimsLabel ? ` ${selectedDimsLabel}` : ""}${selectedWallLabel ? ` [${selectedWallLabel}]` : ""}${selectedRoomLabel ? ` {${selectedRoomLabel}}` : ""} | ` +
        `fps ~${fps.toFixed(0)}`;
    }

    if (overlayElement) {
      const selectedRectangle = getSelectedRectangle(plan, editorState);
      overlayElement.innerHTML =
        `T-0031/0032 active (openings + lighting). Image: ${formatBackgroundImageStatus(backgroundImageState)}.<br>` +
        `Background opacity ${Math.round(plan.background.opacity * 100)}%; ` +
        `frame ${Math.round(plan.background.transform.width)}x${Math.round(plan.background.transform.height)} at ` +
        `${Math.round(plan.background.transform.x)}, ${Math.round(plan.background.transform.y)}.<br>` +
        `${formatScaleDetail(plan.scale)}. Use Calibrate Scale for a reference line or Calibrate by Area with an active room.<br>` +
        `Baseboard candidates: ${formatBaseboardSummaryOverlay(baseboard, showBaseboardOverlay)}.<br>` +
        `Baseboard conflicts: ${formatBaseboardConflictSummaryOverlay(baseboardConflicts, showBaseboardConflictOverlay)}.<br>` +
        `Painting wall height: ${getPlanWallHeightMeters(plan).toFixed(2)}m.<br>` +
        `Openings: ${formatOpeningOverlaySummary(plan, editorState)}.<br>` +
        `Lighting: ${formatLightingOverlaySummary(plan, editorState)}.<br>` +
        `Selected kind: ${formatSelectedRectangleKindOverlay(selectedRectangle)}.<br>` +
        `Selected room tag: ${formatSelectedRectangleRoomTagOverlay(selectedRectangle, plan)}.<br>` +
        `Selected dimensions: ${formatSelectedRectangleDimensionsOverlay(selectedRectangle, plan.scale)}.<br>` +
        `Selected wall cm: ${formatSelectedRectangleWallCmOverlay(selectedRectangle)}.<br>` +
        `Validation: ${formatValidationDetail(validation)}.<br>` +
        `Closure: ${formatClosureValidationOverlay(validation)}.<br>` +
        `Overlap flash: ${formatValidationOverlapFlashOverlay(validation, timestamp)}.<br>` +
        `File I/O: ${formatFileTransferStatusDetail(fileTransferStatus)}.<br>` +
        `Geometry lock: ${isGeometryEditingFrozen(editorState) ? "ON (rectangles cannot move/resize/change kind)" : "OFF"}.<br>` +
        `View mode: rooms ${getPlanViewState(plan).roomHighlighting ? "highlighted" : "white"}; walls ${getPlanViewState(plan).wallsBlack ? "black" : "normal"}. Quote grouping: ${getQuoteModel(plan).groupMode}.<br>` +
        `Baseboard Debug colors: red=counted, amber dashed=excluded, blue dashed=closure gaps. Baseboard Conflicts toggle draws magenta conflict intervals.<br>` +
        `Openings: Place Door/Place Window by clicking near a wall side; drag segment to slide; drag white endpoints to resize on wall.<br>` +
        `Lighting quick use: double-click a switch in Navigate to toggle linked lamps; drag to move switch/lamp.<br>` +
        `Link mode: click switch (source), click lamps to link/unlink. Unplug Selected removes links for selected lamp/switch.<br>` +
        `Merge tool: select touching room rectangles, then Complete Merge. Merged room drag moves as one group; internal seams lock unless Internal Slides is enabled.<br>` +
        `Drag/resize snaps within ${SNAP_TOLERANCE_PX}px. Delete uses toolbar button or Delete/Backspace.<br>` +
        `Normalize CM Grid button snaps all rectangle geometry to 1cm increments (requires calibrated scale).<br>` +
        `Autosave/load still active: ${describeLoadSource(persistenceStatus.loadSource)}; ${formatAutosaveStatusDetail(persistenceStatus)}.`;
    }
  }

  function getBasicValidationResult(plan) {
    if (plan === lastValidatedPlan && lastValidationResult) {
      return lastValidationResult;
    }
    lastValidatedPlan = plan;
    const basicValidation = validateBasicPlanGeometry(plan);
    const lightingFindings = deriveLightingValidationFindings(plan);
    const openingFindings = deriveOpeningValidationFindings(plan);
    const closureFindings = deriveClosureValidationFindings(getBaseboardResult(plan), plan.scale?.metersPerWorldUnit);
    if (lightingFindings.length === 0 && openingFindings.length === 0 && closureFindings.length === 0) {
      lastValidationResult = basicValidation;
      return lastValidationResult;
    }
    const findings = [...basicValidation.findings, ...lightingFindings, ...openingFindings, ...closureFindings];
    const warningCount = findings.filter((finding) => finding.severity === "warning").length;
    const infoCount = findings.filter((finding) => finding.severity === "info").length;
    lastValidationResult = {
      ...basicValidation,
      status: warningCount > 0 ? "warning" : "ok",
      warningCount,
      infoCount,
      findings
    };
    return lastValidationResult;
  }

  function getBaseboardResult(plan) {
    if (plan === lastBaseboardPlan && lastBaseboardResult) {
      return lastBaseboardResult;
    }
    lastBaseboardPlan = plan;
    lastBaseboardResult = deriveBaseboardCandidates(plan, {
      excludedRoomTypes: BASEBOARD_EXCLUDED_ROOM_TYPES
    });
    return lastBaseboardResult;
  }

  function getBaseboardConflictResult(plan, baseboard) {
    if (baseboard === lastBaseboardConflictSource && lastBaseboardConflictResult) {
      return lastBaseboardConflictResult;
    }
    lastBaseboardConflictSource = baseboard;
    lastBaseboardConflictResult = deriveBaseboardConflictOverlay(
      baseboard,
      plan?.scale?.metersPerWorldUnit,
      baseboard?.overlapToleranceWorld
    );
    return lastBaseboardConflictResult;
  }

  function getLockedSeamSides(plan) {
    if (plan === lastLockedSeamsPlan && lastLockedSeamSides) {
      return lastLockedSeamSides;
    }
    lastLockedSeamsPlan = plan;
    lastLockedSeamSides = deriveLockedSeamSides(plan, {
      metersPerWorldUnit: plan.scale?.metersPerWorldUnit
    });
    return lastLockedSeamSides;
  }

  function syncEditorChrome() {
    const snapshot = store.getState();
    const state = snapshot.editorState;
    const quote = getQuoteModel(snapshot.plan);
    const planView = getPlanViewState(snapshot.plan);
    const geometryFrozen = isGeometryEditingFrozen(state);
    const mode = state.interaction.mode;
    if (shellElement) {
      shellElement.dataset.panMode = mode;
      shellElement.dataset.toolMode = state.tool;
    }
    if (controls.toolNavigateButton) {
      controls.toolNavigateButton.setAttribute("aria-pressed", state.tool === "navigate" ? "true" : "false");
    }
    if (controls.toolDrawRectButton) {
      controls.toolDrawRectButton.setAttribute("aria-pressed", state.tool === "drawRect" ? "true" : "false");
      controls.toolDrawRectButton.disabled = geometryFrozen;
    }
    if (controls.toolCalibrateScaleButton) {
      controls.toolCalibrateScaleButton.setAttribute("aria-pressed", state.tool === "calibrateScale" ? "true" : "false");
    }
    if (controls.toolMergeRoomButton) {
      controls.toolMergeRoomButton.setAttribute("aria-pressed", state.tool === "mergeRoom" ? "true" : "false");
      controls.toolMergeRoomButton.disabled = geometryFrozen;
    }
    if (controls.geometryFreezeToggleButton) {
      controls.geometryFreezeToggleButton.setAttribute("aria-pressed", geometryFrozen ? "true" : "false");
      controls.geometryFreezeToggleButton.textContent = geometryFrozen
        ? "Freeze Geometry: On"
        : "Freeze Geometry: Off";
    }
    if (controls.normalizeCmGridButton) {
      const hasScale = Number.isFinite(snapshot.plan.scale?.metersPerWorldUnit) && snapshot.plan.scale.metersPerWorldUnit > 0;
      const hasRectangles = Array.isArray(snapshot.plan?.entities?.rectangles) && snapshot.plan.entities.rectangles.length > 0;
      controls.normalizeCmGridButton.disabled = geometryFrozen || !hasScale || !hasRectangles;
    }
    if (controls.toolPlaceSwitchButton) {
      controls.toolPlaceSwitchButton.setAttribute("aria-pressed", state.tool === "placeSwitch" ? "true" : "false");
    }
    if (controls.toolPlaceLampButton) {
      controls.toolPlaceLampButton.setAttribute("aria-pressed", state.tool === "placeLamp" ? "true" : "false");
    }
    if (controls.toolPlaceDoorButton) {
      controls.toolPlaceDoorButton.setAttribute("aria-pressed", state.tool === "placeDoor" ? "true" : "false");
      controls.toolPlaceDoorButton.disabled = geometryFrozen;
    }
    if (controls.toolPlaceWindowButton) {
      controls.toolPlaceWindowButton.setAttribute("aria-pressed", state.tool === "placeWindow" ? "true" : "false");
      controls.toolPlaceWindowButton.disabled = geometryFrozen;
    }
    if (controls.toolLinkLightingButton) {
      controls.toolLinkLightingButton.setAttribute("aria-pressed", state.tool === "linkLighting" ? "true" : "false");
    }
    if (controls.estimateGroupModeToggleButton) {
      const isJob = quote.groupMode === "job";
      controls.estimateGroupModeToggleButton.setAttribute("aria-pressed", isJob ? "true" : "false");
      controls.estimateGroupModeToggleButton.textContent = isJob
        ? "Group: Job"
        : "Group: Room";
    }
    if (controls.roomHighlightToggleButton) {
      controls.roomHighlightToggleButton.setAttribute("aria-pressed", planView.roomHighlighting ? "true" : "false");
      controls.roomHighlightToggleButton.textContent = planView.roomHighlighting
        ? "Room Highlighting: On"
        : "Room Highlighting: Off";
    }
    if (controls.wallsBlackToggleButton) {
      controls.wallsBlackToggleButton.setAttribute("aria-pressed", planView.wallsBlack ? "true" : "false");
      controls.wallsBlackToggleButton.textContent = planView.wallsBlack
        ? "Walls Black: On"
        : "Walls Black: Off";
    }
    if (controls.roomInternalSlideToggleButton) {
      const enabled = isInternalSeamSlideAdjustEnabled(state);
      controls.roomInternalSlideToggleButton.setAttribute("aria-pressed", enabled ? "true" : "false");
      controls.roomInternalSlideToggleButton.textContent = enabled
        ? "Internal Slides: On"
        : "Internal Slides: Off";
    }
    if (controls.baseboardDebugToggleButton) {
      controls.baseboardDebugToggleButton.setAttribute(
        "aria-pressed",
        isBaseboardOverlayEnabled(state) ? "true" : "false"
      );
    }
    if (controls.baseboardConflictToggleButton) {
      controls.baseboardConflictToggleButton.setAttribute(
        "aria-pressed",
        isBaseboardConflictOverlayEnabled(state) ? "true" : "false"
      );
    }
    if (controls.deleteSelectedButton) {
      controls.deleteSelectedButton.disabled = state.selection.rectangleId == null || geometryFrozen;
    }
    if (controls.deleteSelectedOpeningButton) {
      controls.deleteSelectedOpeningButton.disabled = !getSelectedOpening(snapshot.plan, state) || geometryFrozen;
    }
    if (controls.deleteSelectedFixtureButton) {
      controls.deleteSelectedFixtureButton.disabled = !getSelectedLightingFixture(snapshot.plan, state);
    }
    if (controls.rectangleKindToggleButton) {
      const selectedRectangle = getSelectedRectangle(snapshot.plan, state);
      const isWallRect = selectedRectangle?.kind === "wallRect";
      controls.rectangleKindToggleButton.disabled = !selectedRectangle || geometryFrozen;
      controls.rectangleKindToggleButton.setAttribute("aria-pressed", isWallRect ? "true" : "false");
      controls.rectangleKindToggleButton.textContent = selectedRectangle
        ? (isWallRect ? "Set As Room" : "Set As Wall")
        : "Set As Wall";
    }
    syncWallControls(snapshot.plan, state);
    syncRoomControls(snapshot.plan, state);
    syncMergeControls(snapshot.plan, state);
    syncLightingControls(snapshot.plan, state);
    syncOpeningControls(snapshot.plan, state);
    syncPaintingControls(snapshot.plan);
    syncAreaScaleCalibrationControl(snapshot.plan, state);
    if (controls.backgroundStatusElement) {
      controls.backgroundStatusElement.textContent = formatBackgroundShort(snapshot.plan.background, backgroundImageState);
    }
    if (controls.scaleStatusElement) {
      controls.scaleStatusElement.textContent = formatScaleToolbarStatus(snapshot.plan.scale);
    }
    const baseboardResult = getBaseboardResult(snapshot.plan);
    syncRoomsSidebar(snapshot.plan, state, baseboardResult);
    syncEstimatePanel(snapshot.plan, baseboardResult);
  }

  function ensureBackgroundImageLoaded(background) {
    const source = background?.source;
    if (!source || typeof source !== "string") {
      if (backgroundImageState.src !== null) {
        backgroundImageState.src = null;
        backgroundImageState.image = null;
        backgroundImageState.status = "idle";
        backgroundImageState.errorMessage = null;
        syncEditorChrome();
      }
      return;
    }

    if (
      backgroundImageState.src === source &&
      (
        backgroundImageState.status === "loading" ||
        backgroundImageState.status === "ready" ||
        backgroundImageState.status === "error"
      )
    ) {
      return;
    }

    backgroundImageState.src = source;
    backgroundImageState.image = null;
    backgroundImageState.status = "loading";
    backgroundImageState.errorMessage = null;
    syncEditorChrome();

    const image = new Image();
    image.decoding = "async";

    image.addEventListener("load", () => {
      if (backgroundImageState.src !== source) {
        return;
      }
      backgroundImageState.image = image;
      backgroundImageState.status = "ready";
      backgroundImageState.errorMessage = null;
      syncEditorChrome();
    });

    image.addEventListener("error", () => {
      if (backgroundImageState.src !== source) {
        return;
      }
      backgroundImageState.image = null;
      backgroundImageState.status = "error";
      backgroundImageState.errorMessage = "image-load-failed";
      syncEditorChrome();
    });

    image.src = source;
  }

  function exportCurrentPlanJson() {
    const { plan } = store.getState();

    try {
      const baseboard = getBaseboardResult(plan);
      const exportPayload = buildPlanExportPayload(plan, {
        baseboard
      });
      const json = JSON.stringify(exportPayload, null, 2);
      const blob = new Blob([json], { type: "application/json" });
      const objectUrl = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = objectUrl;
      anchor.download = buildPlanExportFileName(plan);
      anchor.style.display = "none";
      document.body.append(anchor);
      anchor.click();
      anchor.remove();
      setTimeout(() => URL.revokeObjectURL(objectUrl), 0);

      setFileTransferStatus({
        phase: "exported",
        lastAction: "export",
        message: `Exported ${anchor.download}`
      });
    } catch (error) {
      console.warn("Failed to export plan JSON.", error);
      setFileTransferStatus({
        phase: "error",
        lastAction: "export",
        message: error instanceof Error ? error.message : String(error)
      });
    }
  }

  function setFileTransferStatus(nextStatus) {
    fileTransferStatus = {
      ...fileTransferStatus,
      ...nextStatus,
      at: new Date().toISOString()
    };
  }

  function destroy() {
    destroyed = true;
    autosaveController.destroy();
    if (rafId) {
      cancelAnimationFrame(rafId);
    }
    if (resizeObserver) {
      resizeObserver.disconnect();
    }
    window.removeEventListener("resize", resize);
    window.removeEventListener("keydown", onWindowKeyDown);
    canvas.removeEventListener("pointerdown", onPointerDown);
    canvas.removeEventListener("pointermove", onPointerMove);
    canvas.removeEventListener("pointerup", onPointerUp);
    canvas.removeEventListener("pointercancel", onPointerCancel);
    canvas.removeEventListener("pointerleave", onPointerLeave);
    canvas.removeEventListener("wheel", onWheel);
    canvas.removeEventListener("dblclick", onDoubleClick);
    if (controls.importJsonFileInput) {
      controls.importJsonFileInput.removeEventListener("change", onImportJsonFileChange);
    }
  }

  function deleteSelectedRectangle() {
    const state = store.getState();
    if (isGeometryEditingFrozen(state.editorState)) {
      return false;
    }
    const selectedRectangleId = state.editorState.selection.rectangleId;
    if (!selectedRectangleId) {
      return false;
    }

    store.dispatch({
      type: "plan/rectangles/delete",
      rectangleId: selectedRectangleId
    });
    store.dispatch({ type: "editor/selection/clear" });
    store.dispatch({ type: "editor/openingSelection/clear" });
    store.dispatch({ type: "editor/interaction/end", pointerId: null });
    syncEditorChrome();
    return true;
  }

  function deleteSelectedLightingFixture() {
    const state = store.getState();
    const fixtureId = normalizeRectangleIdForUi(state.editorState?.lightingSelection?.fixtureId);
    if (!fixtureId) {
      return false;
    }
    store.dispatch({
      type: "plan/lighting/deleteFixture",
      fixtureId
    });
    store.dispatch({ type: "editor/lightingSelection/clearFixture" });
    const linkSwitchId = normalizeRectangleIdForUi(state.editorState?.lightingSelection?.linkSwitchId);
    if (linkSwitchId === fixtureId) {
      store.dispatch({ type: "editor/lightingLink/clearSwitch" });
    }
    syncEditorChrome();
    return true;
  }

  function deleteSelectedOpening() {
    const state = store.getState();
    if (isGeometryEditingFrozen(state.editorState)) {
      return false;
    }
    const openingId = normalizeRectangleIdForUi(state.editorState?.openingSelection?.openingId);
    if (!openingId) {
      return false;
    }
    store.dispatch({
      type: "plan/openings/delete",
      openingId
    });
    store.dispatch({ type: "editor/openingSelection/clear" });
    syncEditorChrome();
    return true;
  }

  function unplugSelectedLightingFixture() {
    const snapshot = store.getState();
    const selectedFixture = getSelectedLightingFixture(snapshot.plan, snapshot.editorState);
    if (!selectedFixture) {
      return false;
    }
    if (selectedFixture.kind === "switch") {
      const didUnlink = unlinkAllLightingFromSwitch(selectedFixture.id);
      const linkSourceId = normalizeRectangleIdForUi(snapshot.editorState?.lightingSelection?.linkSwitchId);
      if (linkSourceId === selectedFixture.id) {
        store.dispatch({ type: "editor/lightingLink/clearSwitch" });
      }
      syncEditorChrome();
      return didUnlink;
    }
    if (selectedFixture.kind === "lamp") {
      const didUnplug = unplugLampFromLighting(selectedFixture.id);
      syncEditorChrome();
      return didUnplug;
    }
    return false;
  }

  function unlinkAllLightingFromSwitch(switchId) {
    const normalizedSwitchId = normalizeRectangleIdForUi(switchId);
    if (!normalizedSwitchId) {
      return false;
    }
    const snapshot = store.getState();
    const lighting = getLightingCollections(snapshot.plan);
    const links = lighting.links.filter((link) => link?.switchId === normalizedSwitchId);
    if (links.length === 0) {
      return false;
    }
    for (const link of links) {
      if (!link?.targetType || !link?.targetId) {
        continue;
      }
      store.dispatch({
        type: "plan/lighting/unlinkSwitchTarget",
        switchId: normalizedSwitchId,
        targetType: link.targetType,
        targetId: link.targetId
      });
    }
    return true;
  }

  function unplugLampFromLighting(lampId) {
    const normalizedLampId = normalizeRectangleIdForUi(lampId);
    if (!normalizedLampId) {
      return false;
    }

    const snapshot = store.getState();
    const lighting = getLightingCollections(snapshot.plan);
    let changed = false;

    const directLinks = lighting.links.filter((link) => (
      link?.targetType === "lamp" &&
      link?.targetId === normalizedLampId
    ));
    for (const link of directLinks) {
      const switchId = normalizeRectangleIdForUi(link?.switchId);
      if (!switchId) {
        continue;
      }
      store.dispatch({
        type: "plan/lighting/unlinkSwitchTarget",
        switchId,
        targetType: "lamp",
        targetId: normalizedLampId
      });
      changed = true;
    }

    return changed;
  }

  function createSwitchFixtureAtPointer(worldPoint) {
    const snapshot = store.getState();
    const placement = deriveSwitchPlacementAtPoint(
      snapshot.plan,
      worldPoint,
      snapshot.editorState.selection?.rectangleId
    );
    if (!placement) {
      return false;
    }

    const fixtureId = `fx_user_${nextUserFixtureId++}`;
    store.dispatch({
      type: "plan/lighting/addFixture",
      fixtureId,
      kind: "switch",
      subtype: "switch_single",
      x: placement.x,
      y: placement.y,
      roomId: placement.roomId,
      host: placement.host
    });
    store.dispatch({ type: "editor/selection/clear" });
    store.dispatch({ type: "editor/openingSelection/clear" });
    store.dispatch({ type: "editor/lightingSelection/setFixture", fixtureId });
    return true;
  }

  function createLampFixtureAtPointer(worldPoint) {
    const snapshot = store.getState();
    const roomRectangle = findRoomRectangleAtPoint(snapshot.plan.entities.rectangles, worldPoint);
    const roomId = normalizeRectangleIdForUi(roomRectangle?.roomId) ?? null;
    const host = deriveLampInteriorHostFromRectangle(roomRectangle, worldPoint);
    const fixtureId = `fx_user_${nextUserFixtureId++}`;
    store.dispatch({
      type: "plan/lighting/addFixture",
      fixtureId,
      kind: "lamp",
      subtype: "led_spot",
      x: worldPoint.x,
      y: worldPoint.y,
      roomId,
      host
    });
    store.dispatch({ type: "editor/selection/clear" });
    store.dispatch({ type: "editor/openingSelection/clear" });
    store.dispatch({ type: "editor/lightingSelection/setFixture", fixtureId });
    return true;
  }

  function createOpeningAtPointer(worldPoint, openingKind, zoom = 1) {
    const snapshot = store.getState();
    const placement = deriveOpeningPlacementAtPoint(snapshot.plan, worldPoint, zoom);
    if (!placement) {
      return false;
    }
    const openingId = `op_user_${nextUserOpeningId++}`;
    store.dispatch({
      type: "plan/openings/add",
      openingId,
      kind: openingKind,
      widthWorld: DEFAULT_OPENING_WIDTH_WORLD,
      host: placement.host
    });
    store.dispatch({ type: "editor/selection/clear" });
    store.dispatch({ type: "editor/lightingSelection/clearFixture" });
    store.dispatch({
      type: "editor/openingSelection/set",
      openingId
    });
    return true;
  }

  function toggleLightingSwitchLinkToLamp(lampId) {
    const snapshot = store.getState();
    const switchId = normalizeRectangleIdForUi(snapshot.editorState?.lightingSelection?.linkSwitchId);
    if (!switchId) {
      return false;
    }

    const lighting = getLightingCollections(snapshot.plan);
    const existingLink = lighting.links.find((link) => (
      link?.switchId === switchId &&
      link?.targetType === "lamp" &&
      link?.targetId === lampId
    ));
    if (existingLink) {
      store.dispatch({
        type: "plan/lighting/unlinkSwitchTarget",
        switchId,
        targetType: "lamp",
        targetId: lampId
      });
      return true;
    }

    store.dispatch({
      type: "plan/lighting/linkSwitch",
      switchId,
      targetType: "lamp",
      targetId: lampId
    });
    return true;
  }

  function syncRoomSelectionFromRectangle(rectangle) {
    if (rectangle?.kind === "wallRect") {
      store.dispatch({ type: "editor/roomSelection/clear" });
      return;
    }
    const roomEntryId = rectangle ? deriveRoomEntryIdForRectangle(rectangle) : null;
    if (!roomEntryId) {
      store.dispatch({ type: "editor/roomSelection/clear" });
      return;
    }
    store.dispatch({
      type: "editor/roomSelection/set",
      roomId: roomEntryId
    });
  }

  function adjustSelectedRectangleWallCm(side, delta) {
    const snapshot = store.getState();
    if (isGeometryEditingFrozen(snapshot.editorState)) {
      return false;
    }
    const selectedRectangle = getSelectedRectangle(snapshot.plan, snapshot.editorState);
    if (!selectedRectangle) {
      return false;
    }
    if (selectedRectangle.kind === "wallRect") {
      return false;
    }

    const wallCm = normalizeWallCmForUi(selectedRectangle.wallCm);
    const currentValue = wallCm[side];
    if (!Number.isFinite(currentValue)) {
      return false;
    }

    const nextValue = Math.max(0, currentValue + delta);
    if (nextValue === currentValue) {
      return false;
    }

    store.dispatch({
      type: "plan/rectangles/setWallCm",
      rectangleId: selectedRectangle.id,
      side,
      value: nextValue
    });
    return true;
  }

  function toggleSelectedRectangleKind() {
    const snapshot = store.getState();
    if (isGeometryEditingFrozen(snapshot.editorState)) {
      return false;
    }
    const selectedRectangle = getSelectedRectangle(snapshot.plan, snapshot.editorState);
    if (!selectedRectangle) {
      return false;
    }

    const nextKind = selectedRectangle.kind === "wallRect" ? "roomRect" : "wallRect";
    store.dispatch({
      type: "plan/rectangles/setKind",
      rectangleId: selectedRectangle.id,
      kind: nextKind
    });
    return true;
  }

  function syncWallControls(plan, editorState) {
    const selectedRectangle = getSelectedRectangle(plan, editorState);
    const wallCm = normalizeWallCmForUi(selectedRectangle?.wallCm);
    const hasSelection = Boolean(selectedRectangle);
    const wallEditingEnabled = hasSelection &&
      selectedRectangle.kind !== "wallRect" &&
      !isGeometryEditingFrozen(editorState);

    if (controls.wallStatusElement) {
      controls.wallStatusElement.textContent = hasSelection
        ? (wallEditingEnabled
          ? `T ${wallCm.top} R ${wallCm.right} B ${wallCm.bottom} L ${wallCm.left}`
          : "Wall rect selected")
        : "No selection";
    }
    if (controls.wallTopValueElement) {
      controls.wallTopValueElement.textContent = wallEditingEnabled ? `${wallCm.top}` : "-";
    }
    if (controls.wallRightValueElement) {
      controls.wallRightValueElement.textContent = wallEditingEnabled ? `${wallCm.right}` : "-";
    }
    if (controls.wallBottomValueElement) {
      controls.wallBottomValueElement.textContent = wallEditingEnabled ? `${wallCm.bottom}` : "-";
    }
    if (controls.wallLeftValueElement) {
      controls.wallLeftValueElement.textContent = wallEditingEnabled ? `${wallCm.left}` : "-";
    }

    const buttons = [
      controls.wallTopDecreaseButton,
      controls.wallTopIncreaseButton,
      controls.wallRightDecreaseButton,
      controls.wallRightIncreaseButton,
      controls.wallBottomDecreaseButton,
      controls.wallBottomIncreaseButton,
      controls.wallLeftDecreaseButton,
      controls.wallLeftIncreaseButton
    ];
    for (const button of buttons) {
      if (button) {
        button.disabled = !wallEditingEnabled;
      }
    }
  }

  function assignSelectedRectangleRoomTag() {
    const snapshot = store.getState();
    const selectedRectangle = getSelectedRectangle(snapshot.plan, snapshot.editorState);
    if (!selectedRectangle || selectedRectangle.kind === "wallRect") {
      return false;
    }

    const roomName = controls.roomNameInput ? controls.roomNameInput.value.trim() : "";
    if (!roomName) {
      window.alert("Room name is required.");
      return false;
    }

    const roomType = controls.roomTypeSelect ? controls.roomTypeSelect.value : DEFAULT_ROOM_TYPE;
    store.dispatch({
      type: "plan/rooms/upsertForRectangle",
      rectangleId: selectedRectangle.id,
      roomId: selectedRectangle.roomId,
      name: roomName,
      roomType
    });
    return true;
  }

  function clearSelectedRectangleRoomTag() {
    const snapshot = store.getState();
    const selectedRectangle = getSelectedRectangle(snapshot.plan, snapshot.editorState);
    if (!selectedRectangle || !selectedRectangle.roomId) {
      return false;
    }

    store.dispatch({
      type: "plan/rooms/clearForRectangle",
      rectangleId: selectedRectangle.id
    });
    return true;
  }

  function completeMergeSelection() {
    const snapshot = store.getState();
    if (isGeometryEditingFrozen(snapshot.editorState)) {
      return false;
    }
    const mergeState = getMergeCompletionState(snapshot.plan, snapshot.editorState);
    if (!mergeState.canComplete) {
      return false;
    }

    const selectedRectangleId = normalizeRectangleIdForUi(snapshot.editorState.selection.rectangleId);
    const beforePlan = snapshot.plan;
    const nextState = store.dispatch({
      type: "plan/rooms/mergeRectangles",
      rectangleIds: mergeState.rectangleIds
    });
    if (nextState.plan === beforePlan) {
      return false;
    }

    const keepSelectionId = selectedRectangleId && mergeState.rectangleIds.includes(selectedRectangleId)
      ? selectedRectangleId
      : mergeState.rectangleIds[0] ?? null;
    store.dispatch({ type: "editor/merge/clear" });
    store.dispatch({ type: "editor/tool/set", tool: "navigate" });
    if (keepSelectionId) {
      store.dispatch({ type: "editor/selection/set", rectangleId: keepSelectionId });
    }
    syncEditorChrome();
    return true;
  }

  function cancelMergeSelection() {
    const snapshot = store.getState();
    const hasMergeSelection = Array.isArray(snapshot.editorState.mergeSelection?.rectangleIds)
      && snapshot.editorState.mergeSelection.rectangleIds.length > 0;
    const isMergeTool = snapshot.editorState.tool === "mergeRoom";
    if (!hasMergeSelection && !isMergeTool) {
      return false;
    }
    store.dispatch({ type: "editor/merge/clear" });
    store.dispatch({ type: "editor/tool/set", tool: "navigate" });
    syncEditorChrome();
    return true;
  }

  function dissolveSelectedRectangleRoom() {
    const snapshot = store.getState();
    if (isGeometryEditingFrozen(snapshot.editorState)) {
      return false;
    }
    const selectedRectangle = getSelectedRectangle(snapshot.plan, snapshot.editorState);
    if (!selectedRectangle || typeof selectedRectangle.roomId !== "string" || !selectedRectangle.roomId) {
      return false;
    }
    store.dispatch({
      type: "plan/rooms/dissolveRoom",
      roomId: selectedRectangle.roomId
    });
    store.dispatch({ type: "editor/merge/clear" });
    return true;
  }

  function normalizeAllRectanglesToCentimeterGrid() {
    const snapshot = store.getState();
    if (isGeometryEditingFrozen(snapshot.editorState)) {
      return false;
    }
    const metersPerWorldUnit = snapshot.plan.scale?.metersPerWorldUnit;
    if (!Number.isFinite(metersPerWorldUnit) || metersPerWorldUnit <= 0) {
      window.alert("Calibrate scale first to normalize by centimeters.");
      return false;
    }
    const rectangles = Array.isArray(snapshot.plan?.entities?.rectangles)
      ? snapshot.plan.entities.rectangles
      : [];
    if (rectangles.length === 0) {
      return false;
    }
    const quantizationWorld = getDragQuantizationWorld(metersPerWorldUnit);
    const updates = rectangles.map((rectangle) => ({
      id: rectangle.id,
      x: rectangle.x,
      y: rectangle.y,
      w: rectangle.w,
      h: rectangle.h
    }));
    const normalizedUpdates = normalizeRectangleGeometryUpdates(rectangles, updates, {
      quantizationWorld
    });
    const rectangleById = new Map(rectangles.map((rectangle) => [rectangle.id, rectangle]));
    const changedUpdates = normalizedUpdates.filter((update) => {
      const current = rectangleById.get(update.id);
      if (!current) {
        return false;
      }
      return (
        current.x !== update.x ||
        current.y !== update.y ||
        current.w !== update.w ||
        current.h !== update.h
      );
    });
    if (changedUpdates.length === 0) {
      return false;
    }
    store.dispatch({
      type: "plan/rectangles/setManyGeometry",
      rectangles: changedUpdates
    });
    syncEditorChrome();
    return true;
  }

  function getMergeCompletionState(plan, editorState) {
    const mergeSelectionIds = Array.isArray(editorState.mergeSelection?.rectangleIds)
      ? editorState.mergeSelection.rectangleIds
      : [];
    const rectangleById = new Map(plan.entities.rectangles.map((rectangle) => [rectangle.id, rectangle]));
    const rectangleIds = [];
    let hasInvalidSelection = false;

    for (const rectangleId of mergeSelectionIds) {
      const normalizedRectangleId = normalizeRectangleIdForUi(rectangleId);
      if (!normalizedRectangleId) {
        hasInvalidSelection = true;
        continue;
      }
      const rectangle = rectangleById.get(normalizedRectangleId);
      if (!rectangle || rectangle.kind === "wallRect") {
        hasInvalidSelection = true;
        continue;
      }
      if (!rectangleIds.includes(normalizedRectangleId)) {
        rectangleIds.push(normalizedRectangleId);
      }
    }

    const selectedCount = rectangleIds.length;
    let isConnected = false;
    if (selectedCount >= 2) {
      const adjacency = deriveTouchingAdjacency(plan.entities.rectangles, {
        metersPerWorldUnit: plan.scale?.metersPerWorldUnit
      });
      isConnected = isConnectedSelection(rectangleIds, adjacency);
    }

    let statusLabel = "select at least 2 rectangles";
    if (hasInvalidSelection) {
      statusLabel = "selection has non-room or missing rectangles";
    } else if (selectedCount < 2) {
      statusLabel = "select at least 2 rectangles";
    } else if (!isConnected) {
      statusLabel = "selection must be connected by touching";
    } else {
      statusLabel = "ready";
    }

    return {
      rectangleIds,
      selectedCount,
      isConnected,
      hasInvalidSelection,
      canComplete: !hasInvalidSelection && selectedCount >= 2 && isConnected,
      statusLabel
    };
  }

  function getDragGroupRectangleIds(plan, rectangle) {
    if (!rectangle || rectangle.kind === "wallRect") {
      return [rectangle?.id].filter(Boolean);
    }
    const roomId = normalizeRectangleIdForUi(rectangle.roomId);
    if (!roomId) {
      return [rectangle.id];
    }
    const roomRectangles = plan.entities.rectangles.filter((candidate) => (
      candidate.kind !== "wallRect" &&
      candidate.roomId === roomId
    ));
    if (roomRectangles.length <= 1) {
      return [rectangle.id];
    }
    return roomRectangles.map((candidate) => candidate.id);
  }

  function applyRectangleGeometryUpdates(plan, rectangleUpdates, options = {}) {
    const snapshot = store.getState();
    if (isGeometryEditingFrozen(snapshot.editorState)) {
      return false;
    }
    const normalizedUpdates = normalizeRectangleGeometryUpdates(plan.entities.rectangles, rectangleUpdates, {
      quantizationWorld: getDragQuantizationWorld(plan.scale?.metersPerWorldUnit)
    });
    if (normalizedUpdates.length === 0) {
      return false;
    }

    if (options.enforceRoomConnectivity) {
      const nextRectangles = buildRectanglesAfterGeometryUpdates(plan.entities.rectangles, normalizedUpdates);
      if (!roomsConnectedAfterGeometryUpdates(plan, nextRectangles, normalizedUpdates)) {
        return false;
      }
    }

    store.dispatch({
      type: "plan/rectangles/setManyGeometry",
      rectangles: normalizedUpdates
    });
    return true;
  }

  function syncRoomControls(plan, editorState) {
    const selectedRectangle = getSelectedRectangle(plan, editorState);
    const room = getRoomForRectangle(plan, selectedRectangle);
    const canEditRoom = Boolean(selectedRectangle) && selectedRectangle.kind !== "wallRect";
    const roomType = normalizeRoomTypeForUi(room?.roomType);
    const roomName = room?.name ?? "";

    if (controls.roomStatusElement) {
      if (!selectedRectangle) {
        controls.roomStatusElement.textContent = "No selection";
      } else if (selectedRectangle.kind === "wallRect") {
        controls.roomStatusElement.textContent = "Wall rect selected";
      } else if (room) {
        controls.roomStatusElement.textContent = `${room.name} (${formatRoomTypeLabel(room.roomType)})`;
      } else {
        controls.roomStatusElement.textContent = "Unassigned";
      }
    }

    if (controls.roomNameInput) {
      controls.roomNameInput.disabled = !canEditRoom;
      if (document.activeElement !== controls.roomNameInput) {
        if (canEditRoom) {
          controls.roomNameInput.value = roomName;
        } else {
          controls.roomNameInput.value = "";
        }
      }
    }

    if (controls.roomTypeSelect) {
      controls.roomTypeSelect.disabled = !canEditRoom;
      if (document.activeElement !== controls.roomTypeSelect) {
        if (canEditRoom) {
          controls.roomTypeSelect.value = roomType;
        } else {
          controls.roomTypeSelect.value = DEFAULT_ROOM_TYPE;
        }
      }
    }

    if (controls.roomAssignButton) {
      controls.roomAssignButton.disabled = !canEditRoom;
    }

    if (controls.roomClearButton) {
      controls.roomClearButton.disabled = !canEditRoom || !room;
    }

  }

  function syncMergeControls(plan, editorState) {
    const mergeState = getMergeCompletionState(plan, editorState);
    const mergeMode = editorState.tool === "mergeRoom";
    const geometryFrozen = isGeometryEditingFrozen(editorState);
    const selectedRectangle = getSelectedRectangle(plan, editorState);
    const selectedRoom = getRoomForRectangle(plan, selectedRectangle);

    if (controls.mergeStatusElement) {
      if (geometryFrozen) {
        controls.mergeStatusElement.textContent = "Geometry frozen";
      } else if (mergeState.selectedCount > 0 || mergeState.hasInvalidSelection) {
        controls.mergeStatusElement.textContent = `${mergeState.selectedCount} selected (${mergeState.statusLabel})`;
      } else if (mergeMode) {
        controls.mergeStatusElement.textContent = "Select touching room rectangles";
      } else {
        controls.mergeStatusElement.textContent = "Use Merge Room tool to select rectangles";
      }
    }

    if (controls.roomMergeCompleteButton) {
      controls.roomMergeCompleteButton.disabled = geometryFrozen || !mergeState.canComplete;
    }

    if (controls.roomMergeCancelButton) {
      controls.roomMergeCancelButton.disabled = !(mergeMode || mergeState.selectedCount > 0);
    }

    if (controls.roomDissolveButton) {
      controls.roomDissolveButton.disabled = geometryFrozen || !selectedRoom;
    }
  }

  function syncLightingControls(plan, editorState) {
    const selectedFixture = getSelectedLightingFixture(plan, editorState);
    const quote = getQuoteModel(plan);
    const linkSourceSwitchId = normalizeRectangleIdForUi(editorState?.lightingSelection?.linkSwitchId);
    const selectedLinkSource = linkSourceSwitchId
      ? getLightingFixtureById(plan, linkSourceSwitchId)
      : null;
    const selectedFixtureLabel = selectedFixture
      ? `${selectedFixture.kind} ${selectedFixture.id}`
      : "No fixture selected";
    if (controls.lightingStatusElement) {
      let statusLabel = selectedFixtureLabel;
      if (editorState.tool === "linkLighting") {
        if (selectedLinkSource && selectedLinkSource.kind === "switch") {
          statusLabel = `Source ${selectedLinkSource.id}; click lamps to link/unlink (links are groups)`;
        } else {
          statusLabel = "Link mode: click a switch first, then click lamps";
        }
      }
      controls.lightingStatusElement.textContent = statusLabel;
    }

    if (controls.unplugSelectedFixtureButton) {
      const canUnplug = selectedFixture?.kind === "lamp" || selectedFixture?.kind === "switch";
      controls.unplugSelectedFixtureButton.disabled = !canUnplug;
      controls.unplugSelectedFixtureButton.textContent = selectedFixture?.kind === "switch"
        ? "Unplug Switch Links"
        : (selectedFixture?.kind === "lamp" ? "Unplug Lamp" : "Unplug Selected");
    }

    if (controls.clearLightingLinkSourceButton) {
      controls.clearLightingLinkSourceButton.disabled = !selectedLinkSource;
    }

    if (controls.lightingProductSelect) {
      controls.lightingProductSelect.replaceChildren();
      const select = controls.lightingProductSelect;
      const fixtureKind = selectedFixture?.kind;
      let products = [];
      let fallbackProductId = null;
      if (fixtureKind === "switch") {
        products = quote.catalog.switchProducts;
        fallbackProductId = quote.defaults.switchProductId;
      } else if (fixtureKind === "lamp") {
        products = quote.catalog.lampProducts;
        fallbackProductId = quote.defaults.lampProductId;
      }
      const autoOption = document.createElement("option");
      autoOption.value = "";
      autoOption.textContent = fixtureKind ? "Default Product" : "No fixture selected";
      select.append(autoOption);
      for (const product of products) {
        const option = document.createElement("option");
        option.value = product.id;
        option.textContent = `${product.name} (${formatEstimateCurrency(product.unitPrice)})`;
        select.append(option);
      }
      const selectedProductId = normalizeRectangleIdForUi(selectedFixture?.productId) ?? fallbackProductId ?? "";
      select.value = products.some((product) => product.id === selectedProductId)
        ? selectedProductId
        : "";
      select.disabled = !selectedFixture || products.length === 0;
    }
  }

  function syncOpeningControls(plan, editorState) {
    const selectedOpening = getSelectedOpening(plan, editorState);
    const quote = getQuoteModel(plan);
    if (controls.openingStatusElement) {
      if (!selectedOpening) {
        controls.openingStatusElement.textContent = "No opening selected";
      } else if (selectedOpening.kind === "door") {
        controls.openingStatusElement.textContent = `Door ${selectedOpening.id}`;
      } else {
        controls.openingStatusElement.textContent = `Window ${selectedOpening.id} (free)`;
      }
    }
    if (controls.openingDoorProductSelect) {
      const select = controls.openingDoorProductSelect;
      select.replaceChildren();
      const defaultOption = document.createElement("option");
      defaultOption.value = "";
      defaultOption.textContent = "Default Door Product";
      select.append(defaultOption);
      for (const product of quote.catalog.doorProducts) {
        const option = document.createElement("option");
        option.value = product.id;
        option.textContent = `${product.name} (${formatEstimateCurrency(product.unitPrice)})`;
        select.append(option);
      }
      if (selectedOpening?.kind === "door") {
        const selectedProductId = normalizeRectangleIdForUi(selectedOpening.productId);
        select.value = quote.catalog.doorProducts.some((product) => product.id === selectedProductId)
          ? selectedProductId
          : "";
        select.disabled = false;
      } else {
        select.value = "";
        select.disabled = true;
      }
    }
  }

  function syncPaintingControls(plan) {
    const wallHeightMeters = getPlanWallHeightMeters(plan);
    if (controls.paintingStatusElement) {
      controls.paintingStatusElement.textContent = `h ${wallHeightMeters.toFixed(2)}m`;
    }
    if (controls.wallHeightInput && document.activeElement !== controls.wallHeightInput) {
      controls.wallHeightInput.value = wallHeightMeters.toFixed(2);
    }
  }

  function syncAreaScaleCalibrationControl(plan, editorState) {
    if (!controls.calibrateScaleByAreaButton) {
      return;
    }

    const activeRoomEntry = getActiveRoomEntry(plan, editorState);
    const roomAreaWorld = activeRoomEntry
      ? computeRoomMetrics(activeRoomEntry, plan, null, null).areaWorld
      : 0;
    const canCalibrate = Number.isFinite(roomAreaWorld) && roomAreaWorld > 0;
    controls.calibrateScaleByAreaButton.disabled = !canCalibrate;
    controls.calibrateScaleByAreaButton.title = canCalibrate
      ? `Calibrate using area of ${activeRoomEntry.name}`
      : "Select a room first";
  }

  function applyWallHeightFromControl() {
    if (!controls.wallHeightInput) {
      return;
    }
    const parsed = Number.parseFloat(String(controls.wallHeightInput.value).trim());
    if (!Number.isFinite(parsed) || parsed <= 0) {
      syncPaintingControls(store.getState().plan);
      return;
    }
    store.dispatch({
      type: "plan/settings/setWallHeightMeters",
      wallHeightMeters: parsed
    });
    syncEditorChrome();
  }

  function getEstimateSelectValue(container, inputKey) {
    if (!(container instanceof HTMLElement)) {
      return null;
    }
    const select = container.querySelector(`[data-quote-input='${inputKey}']`);
    if (!(select instanceof HTMLSelectElement)) {
      return null;
    }
    return normalizeRectangleIdForUi(select.value);
  }

  function readEstimateControlNumber(container, inputKey) {
    if (!(container instanceof HTMLElement)) {
      return null;
    }
    const input = container.querySelector(`[data-quote-input='${inputKey}']`);
    if (!(input instanceof HTMLInputElement)) {
      return null;
    }
    const value = Number.parseFloat(String(input.value).trim());
    if (!Number.isFinite(value) || value < 0) {
      return null;
    }
    return value;
  }

  function syncEstimateRateInputsForAreaType(container, prefix, typeItem) {
    if (!(container instanceof HTMLElement)) {
      return;
    }
    const materialInput = container.querySelector(`[data-quote-input='${prefix}-materialPerM2']`);
    const laborInput = container.querySelector(`[data-quote-input='${prefix}-laborPerM2']`);
    if (materialInput instanceof HTMLInputElement) {
      materialInput.value = Number.isFinite(typeItem?.materialPerM2) ? typeItem.materialPerM2.toFixed(2) : "0.00";
    }
    if (laborInput instanceof HTMLInputElement) {
      laborInput.value = Number.isFinite(typeItem?.laborPerM2) ? typeItem.laborPerM2.toFixed(2) : "0.00";
    }
  }

  function syncEstimateRateInputsForBaseboard(container, profile) {
    if (!(container instanceof HTMLElement)) {
      return;
    }
    const materialInput = container.querySelector("[data-quote-input='baseboard-materialPerM']");
    const laborInput = container.querySelector("[data-quote-input='baseboard-laborPerM']");
    if (materialInput instanceof HTMLInputElement) {
      materialInput.value = Number.isFinite(profile?.materialPerM) ? profile.materialPerM.toFixed(2) : "0.00";
    }
    if (laborInput instanceof HTMLInputElement) {
      laborInput.value = Number.isFinite(profile?.laborPerM) ? profile.laborPerM.toFixed(2) : "0.00";
    }
  }

  function applyAreaTypeRatesFromEstimateControls(options) {
    const {
      catalogKey,
      selectInputKey,
      materialInputKey,
      laborInputKey,
      defaultKey,
      quote
    } = options ?? {};
    if (!controls.estimateBodyElement) {
      return;
    }
    const selectedTypeId = getEstimateSelectValue(controls.estimateBodyElement, selectInputKey);
    const selectedType = resolveQuoteCatalogItemById(
      quote?.catalog?.[catalogKey] ?? [],
      selectedTypeId,
      quote?.defaults?.[defaultKey]
    );
    if (!selectedType) {
      return;
    }
    const materialPerM2 = readEstimateControlNumber(controls.estimateBodyElement, materialInputKey);
    const laborPerM2 = readEstimateControlNumber(controls.estimateBodyElement, laborInputKey);
    if (materialPerM2 == null || laborPerM2 == null) {
      return;
    }
    store.dispatch({
      type: "plan/quote/upsertCatalogItem",
      catalogKey,
      item: {
        ...selectedType,
        materialPerM2,
        laborPerM2
      }
    });
    store.dispatch({
      type: "plan/quote/setDefault",
      key: defaultKey,
      value: selectedType.id
    });
    syncEditorChrome();
  }

  function applyUnitPriceFromEstimateControls(quote, catalogKey, defaultKey, inputKey) {
    if (!controls.estimateBodyElement) {
      return;
    }
    const selectedProduct = resolveQuoteCatalogItemById(
      quote?.catalog?.[catalogKey] ?? [],
      quote?.defaults?.[defaultKey],
      quote?.defaults?.[defaultKey]
    );
    if (!selectedProduct) {
      return;
    }
    const unitPrice = readEstimateControlNumber(controls.estimateBodyElement, inputKey);
    if (unitPrice == null) {
      return;
    }
    store.dispatch({
      type: "plan/quote/upsertCatalogItem",
      catalogKey,
      item: {
        ...selectedProduct,
        unitPrice
      }
    });
    store.dispatch({
      type: "plan/quote/setDefault",
      key: defaultKey,
      value: selectedProduct.id
    });
  }

  function activateRoomFromSidebar(roomId, options = {}) {
    const normalizedRoomId = normalizeRectangleIdForUi(roomId);
    if (!normalizedRoomId) {
      return false;
    }
    const snapshot = store.getState();
    const rooms = deriveSidebarRooms(snapshot.plan);
    const roomEntry = rooms.find((entry) => entry.id === normalizedRoomId);
    if (!roomEntry) {
      return false;
    }

    store.dispatch({
      type: "editor/roomSelection/set",
      roomId: roomEntry.id
    });

    const firstRectangleId = roomEntry.rectangleIds[0] ?? null;
    if (firstRectangleId) {
      store.dispatch({
        type: "editor/selection/set",
        rectangleId: firstRectangleId
      });
      store.dispatch({ type: "editor/openingSelection/clear" });
      store.dispatch({ type: "editor/lightingSelection/clearFixture" });
    }

    if (options.center) {
      centerCameraOnRoom(snapshot.plan, snapshot.editorState, roomEntry);
    }

    syncEditorChrome();
    return true;
  }

  function centerCameraOnRoom(plan, editorState, roomEntry) {
    const rectangleById = new Map(plan.entities.rectangles.map((rectangle) => [rectangle.id, rectangle]));
    const roomRectangles = roomEntry.rectangleIds
      .map((rectangleId) => rectangleById.get(rectangleId))
      .filter((rectangle) => rectangle && rectangle.kind !== "wallRect");
    if (roomRectangles.length === 0) {
      return false;
    }

    const bounds = getRectanglesBounds(roomRectangles, {
      getBounds: (rectangle) => getRectangleHitBounds(rectangle, plan.scale)
    });
    if (!bounds) {
      return false;
    }

    const viewportWidth = Math.max(1, editorState.viewport?.cssWidth ?? 1);
    const viewportHeight = Math.max(1, editorState.viewport?.cssHeight ?? 1);
    const zoom = editorState.camera.zoom;
    const centerX = bounds.x + bounds.w / 2;
    const centerY = bounds.y + bounds.h / 2;
    const cameraX = centerX - viewportWidth / (2 * zoom);
    const cameraY = centerY - viewportHeight / (2 * zoom);

    store.dispatch({
      type: "editor/camera/setPose",
      x: cameraX,
      y: cameraY
    });
    return true;
  }

  function syncRoomsSidebar(plan, editorState, baseboard) {
    const { roomListElement, roomSummaryElement, roomTotalsElement } = controls;
    if (!roomListElement && !roomSummaryElement && !roomTotalsElement) {
      return;
    }

    const roomEntries = deriveSidebarRooms(plan);
    const roomEntryIdSet = new Set(roomEntries.map((entry) => entry.id));
    for (const openId of Array.from(roomTreeOpenIds)) {
      if (!roomEntryIdSet.has(openId)) {
        roomTreeOpenIds.delete(openId);
      }
    }
    const effectiveActiveRoomId = deriveEffectiveActiveRoomId(plan, editorState, roomEntries);
    const metersPerWorldUnit = plan.scale?.metersPerWorldUnit;
    const wallHeightMeters = getPlanWallHeightMeters(plan);
    const totalMetrics = computeRoomsAggregateMetrics(roomEntries, plan, baseboard, metersPerWorldUnit, wallHeightMeters);
    const lightingTotals = computeLightingTotals(plan);

    if (roomSummaryElement) {
      const roomCountLabel = `${roomEntries.length} room${roomEntries.length === 1 ? "" : "s"}`;
      roomSummaryElement.textContent = roomEntries.length === 0
        ? "No rooms tagged yet."
        : `${roomCountLabel} • click room row to select • click arrow to fold`;
    }

    if (roomTotalsElement) {
      const subtypeLabel = formatLightingSubtypeCounts(lightingTotals.subtypeCounts);
      roomTotalsElement.textContent =
        `Total: area ${totalMetrics.areaLabel} • baseboard ${totalMetrics.baseboardLabel} • paint ${totalMetrics.paintingAreaLabel} • switches ${lightingTotals.switchCount} • lamps ${lightingTotals.lampCount} • groups ${lightingTotals.groupCount} • links ${lightingTotals.linkCount}${subtypeLabel ? ` • ${subtypeLabel}` : ""}`;
    }

    if (roomListElement) {
      roomListElement.replaceChildren();
      if (roomEntries.length === 0) {
        const empty = document.createElement("div");
        empty.className = "rooms-empty";
        empty.textContent = "Create or merge room rectangles to populate this list.";
        roomListElement.append(empty);
      } else {
        for (const roomEntry of roomEntries) {
          const roomLighting = computeRoomLightingCounts(roomEntry, plan);
          const item = document.createElement("details");
          item.className = "room-tree-item";
          if (roomEntry.id === effectiveActiveRoomId) {
            item.classList.add("active");
          }
          item.dataset.roomItemId = roomEntry.id;
          item.open = roomTreeOpenIds.has(roomEntry.id);

          const summary = document.createElement("summary");
          summary.className = "room-tree-summary";
          summary.dataset.roomItemId = roomEntry.id;

          const foldButton = document.createElement("button");
          foldButton.type = "button";
          foldButton.className = "room-tree-fold";
          foldButton.dataset.roomItemId = roomEntry.id;
          foldButton.textContent = item.open ? "▾" : "▸";
          foldButton.setAttribute("aria-label", item.open ? "Collapse room details" : "Expand room details");

          const swatch = document.createElement("span");
          swatch.className = "room-list-swatch";
          swatch.style.background = roomColor(roomEntry.id, 0.9);

          const name = document.createElement("span");
          name.className = "room-list-name";
          name.textContent = roomEntry.name;

          const stats = document.createElement("span");
          stats.className = "room-list-stats";
          stats.textContent = `S ${roomLighting.switchCount} • L ${roomLighting.lampCount} • G ${roomLighting.groupCount}`;

          const main = document.createElement("span");
          main.className = "room-list-main";
          main.append(name, stats);

          const meta = document.createElement("span");
          meta.className = "room-list-meta";
          meta.textContent = `${roomEntry.rectangleIds.length} rect`;
          if (roomEntry.rectangleIds.length !== 1) {
            meta.textContent += "s";
          }

          summary.append(foldButton, swatch, main, meta);

          const body = document.createElement("div");
          body.className = "room-tree-body";
          if (item.open) {
            body.innerHTML = buildRoomInventoryDetailsHtml(
              roomEntry,
              plan,
              baseboard,
              metersPerWorldUnit
            );
          }

          item.append(summary, body);
          roomListElement.append(item);
        }
      }
    }
  }

  function syncEstimatePanel(plan, baseboard) {
    if (controls.estimateToggleButton) {
      controls.estimateToggleButton.setAttribute("aria-pressed", estimatePanelOpen ? "true" : "false");
      controls.estimateToggleButton.textContent = estimatePanelOpen
        ? "Estimate: On"
        : "Estimate: Off";
    }

    if (controls.estimatePanelElement) {
      controls.estimatePanelElement.hidden = !estimatePanelOpen;
    }

    if (!estimatePanelOpen || !controls.estimateBodyElement) {
      return;
    }

    controls.estimateBodyElement.innerHTML = buildEstimatePreviewHtml(
      plan,
      baseboard,
      plan.scale?.metersPerWorldUnit
    );
  }

  function buildEstimatePreviewHtml(plan, baseboard, metersPerWorldUnit) {
    const roomEntries = deriveSidebarRooms(plan);
    const quote = getQuoteModel(plan);
    const wallHeightMeters = getPlanWallHeightMeters(plan);
    const breakdowns = roomEntries.map((roomEntry) => deriveRoomEstimateBreakdown(
      roomEntry,
      plan,
      baseboard,
      metersPerWorldUnit,
      wallHeightMeters,
      quote
    ));
    const hasScaledCosts = breakdowns.some((breakdown) => breakdown.hasScaledAmount);
    const grandTotal = breakdowns.reduce(
      (sum, breakdown) => sum + (Number.isFinite(breakdown.roomTotal) ? breakdown.roomTotal : 0),
      0
    );
    const settingsHtml = buildEstimateSettingsHtml(quote);
    if (roomEntries.length === 0) {
      return `${settingsHtml}<div class="estimate-empty">No rooms available for estimate.</div>`;
    }

    const bodyHtml = quote.groupMode === "job"
      ? buildEstimateByJobHtml(breakdowns)
      : buildEstimateByRoomHtml(breakdowns);
    const scaleNote = hasScaledCosts
      ? ""
      : `<div class="estimate-note">Scale is not calibrated: baseboard/flooring/painting costs require scale.</div>`;

    return (
      `${settingsHtml}` +
      `<div class="estimate-table">` +
      `<div class="estimate-row estimate-row-header">` +
      `<span class="estimate-col-label">Item</span>` +
      `<span class="estimate-col-qty">Qty</span>` +
      `<span class="estimate-col-rate">Rate</span>` +
      `<span class="estimate-col-amount">Amount</span>` +
      `</div>` +
      `${bodyHtml}` +
      `<div class="estimate-row estimate-row-grand-total">` +
      `<span class="estimate-col-label">GRAND TOTAL</span>` +
      `<span class="estimate-col-qty"></span>` +
      `<span class="estimate-col-rate"></span>` +
      `<span class="estimate-col-amount">${formatEstimateCurrency(grandTotal)}</span>` +
      `</div>` +
      `${scaleNote}` +
      `</div>`
    );
  }

  function buildEstimateSettingsHtml(quote) {
    const flooringType = resolveQuoteCatalogItemById(
      quote.catalog.flooringTypes,
      quote.defaults.flooringTypeId,
      quote.defaults.flooringTypeId
    );
    const paintingType = resolveQuoteCatalogItemById(
      quote.catalog.paintingTypes,
      quote.defaults.paintingTypeId,
      quote.defaults.paintingTypeId
    );
    const baseboardProfile = resolveQuoteCatalogItemById(
      quote.catalog.baseboardProfiles,
      quote.defaults.baseboardProfileId,
      quote.defaults.baseboardProfileId
    );
    const switchProduct = resolveQuoteCatalogItemById(
      quote.catalog.switchProducts,
      quote.defaults.switchProductId,
      quote.defaults.switchProductId
    );
    const lampProduct = resolveQuoteCatalogItemById(
      quote.catalog.lampProducts,
      quote.defaults.lampProductId,
      quote.defaults.lampProductId
    );
    const doorProduct = resolveQuoteCatalogItemById(
      quote.catalog.doorProducts,
      quote.defaults.doorProductId,
      quote.defaults.doorProductId
    );

    const flooringOptions = quote.catalog.flooringTypes.map((item) => (
      `<option value="${escapeHtmlForOverlay(item.id)}"${item.id === flooringType?.id ? " selected" : ""}>${escapeHtmlForOverlay(item.name)}</option>`
    )).join("");
    const paintingOptions = quote.catalog.paintingTypes.map((item) => (
      `<option value="${escapeHtmlForOverlay(item.id)}"${item.id === paintingType?.id ? " selected" : ""}>${escapeHtmlForOverlay(item.name)}</option>`
    )).join("");
    const baseboardOptions = quote.catalog.baseboardProfiles.map((item) => (
      `<option value="${escapeHtmlForOverlay(item.id)}"${item.id === baseboardProfile?.id ? " selected" : ""}>${escapeHtmlForOverlay(item.name)}</option>`
    )).join("");

    return (
      `<details class="estimate-settings">` +
      `<summary>Quote Settings</summary>` +
      `<div class="estimate-settings-body">` +
      `<div class="estimate-settings-grid">` +
      `<label>Baseboard Profile<select data-quote-input="baseboardProfileId">${baseboardOptions}</select></label>` +
      `<label>Baseboard Material / m<input type="number" step="0.01" min="0" data-quote-input="baseboard-materialPerM" value="${Number.isFinite(baseboardProfile?.materialPerM) ? baseboardProfile.materialPerM.toFixed(2) : "0.00"}"></label>` +
      `<label>Baseboard Work / m<input type="number" step="0.01" min="0" data-quote-input="baseboard-laborPerM" value="${Number.isFinite(baseboardProfile?.laborPerM) ? baseboardProfile.laborPerM.toFixed(2) : "0.00"}"></label>` +
      `<button type="button" data-quote-action="apply-baseboard-rates">Apply Baseboard Rates</button>` +
      `<label>Flooring Type<select data-quote-input="flooringTypeId">${flooringOptions}</select></label>` +
      `<label>Flooring Material / m²<input type="number" step="0.01" min="0" data-quote-input="flooring-materialPerM2" value="${Number.isFinite(flooringType?.materialPerM2) ? flooringType.materialPerM2.toFixed(2) : "0.00"}"></label>` +
      `<label>Flooring Work / m²<input type="number" step="0.01" min="0" data-quote-input="flooring-laborPerM2" value="${Number.isFinite(flooringType?.laborPerM2) ? flooringType.laborPerM2.toFixed(2) : "0.00"}"></label>` +
      `<button type="button" data-quote-action="apply-flooring-rates">Apply Flooring Rates</button>` +
      `<label>New Flooring Type<input type="text" maxlength="64" placeholder="Tiles Premium" data-quote-input="new-flooring-name"></label>` +
      `<button type="button" data-quote-action="add-flooring-type">Add Flooring Type</button>` +
      `<label>Painting Type<select data-quote-input="paintingTypeId">${paintingOptions}</select></label>` +
      `<label>Painting Material / m²<input type="number" step="0.01" min="0" data-quote-input="painting-materialPerM2" value="${Number.isFinite(paintingType?.materialPerM2) ? paintingType.materialPerM2.toFixed(2) : "0.00"}"></label>` +
      `<label>Painting Work / m²<input type="number" step="0.01" min="0" data-quote-input="painting-laborPerM2" value="${Number.isFinite(paintingType?.laborPerM2) ? paintingType.laborPerM2.toFixed(2) : "0.00"}"></label>` +
      `<button type="button" data-quote-action="apply-painting-rates">Apply Painting Rates</button>` +
      `<label>New Painting Type<input type="text" maxlength="64" placeholder="Bathroom Paint" data-quote-input="new-painting-name"></label>` +
      `<button type="button" data-quote-action="add-painting-type">Add Painting Type</button>` +
      `<label>Switch Price (default)<input type="number" step="0.01" min="0" data-quote-input="switch-unitPrice" value="${Number.isFinite(switchProduct?.unitPrice) ? switchProduct.unitPrice.toFixed(2) : "0.00"}"></label>` +
      `<label>Lamp Price (default)<input type="number" step="0.01" min="0" data-quote-input="lamp-unitPrice" value="${Number.isFinite(lampProduct?.unitPrice) ? lampProduct.unitPrice.toFixed(2) : "0.00"}"></label>` +
      `<label>Door Price (default)<input type="number" step="0.01" min="0" data-quote-input="door-unitPrice" value="${Number.isFinite(doorProduct?.unitPrice) ? doorProduct.unitPrice.toFixed(2) : "0.00"}"></label>` +
      `<button type="button" data-quote-action="apply-unit-prices">Apply Unit Prices</button>` +
      `</div>` +
      `<div class="estimate-note">Windows are fixed as free (qty tracked, amount always ${ESTIMATE_CURRENCY_SYMBOL}0.00).</div>` +
      `</div>` +
      `</details>`
    );
  }

  function buildEstimateByRoomHtml(breakdowns) {
    return breakdowns.map((breakdown) => {
      const roomLabel = escapeHtmlForOverlay(breakdown.roomEntry.name);
      const rowCountLabel = `${breakdown.roomEntry.rectangleIds.length} rect${breakdown.roomEntry.rectangleIds.length === 1 ? "" : "s"}`;
      const baseboardRows = breakdown.baseboardSegments.slice(0, 12).map((segment, index) => (
        `<div class="estimate-row estimate-row-indent-2">` +
        `<span class="estimate-col-label">${escapeHtmlForOverlay(`${index + 1}. ${segment.rectangleId}:${segment.side}`)}</span>` +
        `<span class="estimate-col-qty">${escapeHtmlForOverlay(formatLengthLabel(segment.lengthWorld, segment.lengthMeters))}</span>` +
        `<span class="estimate-col-rate">-</span>` +
        `<span class="estimate-col-amount">-</span>` +
        `</div>`
      )).join("");
      const hiddenBaseboardCount = Math.max(0, breakdown.baseboardSegments.length - 12);
      const hiddenBaseboardRow = hiddenBaseboardCount > 0
        ? `<div class="estimate-row estimate-row-indent-2 estimate-row-note"><span class="estimate-col-label">... ${hiddenBaseboardCount} more segments</span><span></span><span></span><span></span></div>`
        : "";
      const lightingRows = breakdown.lightingRows.map((row) => buildEstimateRowHtml(row, "estimate-row-indent-2")).join("");
      const doorRows = breakdown.doorRows.map((row) => buildEstimateRowHtml(row, "estimate-row-indent-2")).join("");
      const windowRow = buildEstimateRowHtml(breakdown.windowRow, "estimate-row-indent-2");

      return (
        `<details class="estimate-room-block">` +
        `<summary class="estimate-row estimate-row-room">` +
        `<span class="estimate-col-label">${roomLabel}</span>` +
        `<span class="estimate-col-qty">${rowCountLabel}</span>` +
        `<span class="estimate-col-rate"></span>` +
        `<span class="estimate-col-amount">${formatEstimateCurrency(breakdown.roomTotal)}</span>` +
        `</summary>` +
        `<div class="estimate-children">` +
        `<details class="estimate-sub-block">` +
        `<summary>${buildEstimateRowHtml(breakdown.baseboardRow, "estimate-row estimate-row-indent-1", true)}</summary>` +
        `<div class="estimate-children">${baseboardRows}${hiddenBaseboardRow}</div>` +
        `</details>` +
        `${buildEstimateRowHtml(breakdown.flooringRow, "estimate-row estimate-row-indent-1")}` +
        `${buildEstimateRowHtml(breakdown.paintingRow, "estimate-row estimate-row-indent-1")}` +
        `<details class="estimate-sub-block">` +
        `<summary>${buildEstimateRowHtml(breakdown.lightingSummaryRow, "estimate-row estimate-row-indent-1", true)}</summary>` +
        `<div class="estimate-children">${lightingRows || `<div class="estimate-row estimate-row-indent-2 estimate-row-note"><span class="estimate-col-label">No lighting fixtures in this room.</span><span></span><span></span><span></span></div>`}</div>` +
        `</details>` +
        `<details class="estimate-sub-block">` +
        `<summary>${buildEstimateRowHtml(breakdown.openingsSummaryRow, "estimate-row estimate-row-indent-1", true)}</summary>` +
        `<div class="estimate-children">${doorRows || `<div class="estimate-row estimate-row-indent-2 estimate-row-note"><span class="estimate-col-label">No doors in this room.</span><span></span><span></span><span></span></div>`}${windowRow}</div>` +
        `</details>` +
        `<div class="estimate-row estimate-row-total">` +
        `<span class="estimate-col-label">Room Total</span>` +
        `<span class="estimate-col-qty"></span>` +
        `<span class="estimate-col-rate"></span>` +
        `<span class="estimate-col-amount">${formatEstimateCurrency(breakdown.roomTotal)}</span>` +
        `</div>` +
        `</div>` +
        `</details>`
      );
    }).join("");
  }

  function buildEstimateByJobHtml(breakdowns) {
    const groups = [
      { key: "baseboardRow", label: "Baseboard" },
      { key: "flooringRow", label: "Flooring" },
      { key: "paintingRow", label: "Painting" },
      { key: "lightingSummaryRow", label: "Lighting" },
      { key: "openingsSummaryRow", label: "Openings" }
    ];
    return groups.map((group) => {
      const rows = breakdowns.map((breakdown) => ({
        ...breakdown[group.key],
        label: `${breakdown.roomEntry.name} — ${breakdown[group.key].label}`
      }));
      const total = rows.reduce((sum, row) => sum + (Number.isFinite(row.amount) ? row.amount : 0), 0);
      const childRows = rows.map((row) => buildEstimateRowHtml(row, "estimate-row estimate-row-indent-1")).join("");
      return (
        `<details class="estimate-room-block">` +
        `<summary class="estimate-row estimate-row-room">` +
        `<span class="estimate-col-label">${escapeHtmlForOverlay(group.label)}</span>` +
        `<span class="estimate-col-qty">${rows.length} room${rows.length === 1 ? "" : "s"}</span>` +
        `<span class="estimate-col-rate"></span>` +
        `<span class="estimate-col-amount">${formatEstimateCurrency(total)}</span>` +
        `</summary>` +
        `<div class="estimate-children">${childRows}</div>` +
        `</details>`
      );
    }).join("");
  }

  function deriveRoomEstimateBreakdown(roomEntry, plan, baseboard, metersPerWorldUnit, wallHeightMeters, quote) {
    const metrics = computeRoomMetrics(roomEntry, plan, baseboard, metersPerWorldUnit);
    const painting = deriveRoomPaintingBreakdown(roomEntry, plan, baseboard, metersPerWorldUnit, wallHeightMeters);
    const roomConfig = getRoomQuoteConfig(quote, roomEntry.id);
    const baseboardProfile = resolveQuoteCatalogItemById(
      quote.catalog.baseboardProfiles,
      roomConfig.baseboardProfileId,
      quote.defaults.baseboardProfileId
    );
    const flooringType = resolveQuoteCatalogItemById(
      quote.catalog.flooringTypes,
      roomConfig.flooringTypeId,
      quote.defaults.flooringTypeId
    );
    const paintingType = resolveQuoteCatalogItemById(
      quote.catalog.paintingTypes,
      roomConfig.paintingTypeId,
      quote.defaults.paintingTypeId
    );
    const baseboardSegments = deriveRoomBaseboardSegments(roomEntry, baseboard);
    const baseboardQty = metrics.baseboardMeters;
    const flooringQty = metrics.areaM2;
    const paintingQty = Number.isFinite(painting.totalAreaM2) ? painting.totalAreaM2 : null;

    const baseboardRate = Number.isFinite(baseboardProfile?.materialPerM) && Number.isFinite(baseboardProfile?.laborPerM)
      ? baseboardProfile.materialPerM + baseboardProfile.laborPerM
      : null;
    const flooringRate = Number.isFinite(flooringType?.materialPerM2) && Number.isFinite(flooringType?.laborPerM2)
      ? flooringType.materialPerM2 + flooringType.laborPerM2
      : null;
    const paintingRate = Number.isFinite(paintingType?.materialPerM2) && Number.isFinite(paintingType?.laborPerM2)
      ? paintingType.materialPerM2 + paintingType.laborPerM2
      : null;

    const baseboardAmount = roomConfig.includeBaseboard
      ? (Number.isFinite(baseboardQty) && Number.isFinite(baseboardRate) ? baseboardQty * baseboardRate : null)
      : 0;
    const flooringAmount = Number.isFinite(flooringQty) && Number.isFinite(flooringRate)
      ? flooringQty * flooringRate
      : null;
    const paintingAmount = Number.isFinite(paintingQty) && Number.isFinite(paintingRate)
      ? paintingQty * paintingRate
      : null;

    const lightingSummary = deriveRoomLightingQuoteSummary(roomEntry, plan, quote);
    const openingSummary = deriveRoomOpeningQuoteSummary(roomEntry, plan, quote);
    const roomTotal = [
      baseboardAmount,
      flooringAmount,
      paintingAmount,
      lightingSummary.totalAmount,
      openingSummary.totalAmount
    ].reduce((sum, value) => sum + (Number.isFinite(value) ? value : 0), 0);

    return {
      roomEntry,
      hasScaledAmount: Number.isFinite(baseboardAmount) || Number.isFinite(flooringAmount) || Number.isFinite(paintingAmount),
      roomTotal,
      baseboardSegments,
      baseboardRow: {
        label: `Baseboard${roomConfig.includeBaseboard ? "" : " (excluded for quote)"}`,
        qtyLabel: Number.isFinite(baseboardQty) ? `${baseboardQty.toFixed(2)} m` : `${metrics.baseboardWorld.toFixed(1)} wu`,
        rateLabel: roomConfig.includeBaseboard
          ? (Number.isFinite(baseboardRate) ? formatEstimateRate(baseboardRate, "m") : "set scale")
          : "excluded",
        amount: baseboardAmount
      },
      flooringRow: {
        label: `Flooring (${flooringType?.name ?? "type"})`,
        qtyLabel: Number.isFinite(flooringQty) ? `${flooringQty.toFixed(2)} m²` : `${metrics.areaWorld.toFixed(1)} wu²`,
        rateLabel: Number.isFinite(flooringRate) ? formatEstimateRate(flooringRate, "m²") : "set scale",
        amount: flooringAmount
      },
      paintingRow: {
        label: `Painting (${paintingType?.name ?? "type"})`,
        qtyLabel: Number.isFinite(paintingQty) ? `${paintingQty.toFixed(2)} m²` : "set scale",
        rateLabel: Number.isFinite(paintingRate) ? formatEstimateRate(paintingRate, "m²") : "set scale",
        amount: paintingAmount
      },
      lightingSummaryRow: {
        label: "Lighting",
        qtyLabel: `${lightingSummary.itemCount} items`,
        rateLabel: "catalog",
        amount: lightingSummary.totalAmount
      },
      openingsSummaryRow: {
        label: "Openings",
        qtyLabel: `${openingSummary.doorCount + openingSummary.windowCount} items`,
        rateLabel: "doors + windows free",
        amount: openingSummary.totalAmount
      },
      lightingRows: lightingSummary.rows,
      doorRows: openingSummary.doorRows,
      windowRow: openingSummary.windowRow
    };
  }

  function deriveRoomLightingQuoteSummary(roomEntry, plan, quote) {
    const membership = deriveRoomLightingMembership(roomEntry, plan);
    const rows = [];
    let totalAmount = 0;
    let itemCount = 0;
    const switchCounts = new Map();
    const lampCounts = new Map();
    for (const switchId of membership.switchIdsInRoom) {
      const fixture = membership.fixtureById.get(switchId);
      if (!fixture) {
        continue;
      }
      const product = resolveQuoteCatalogItemById(
        quote.catalog.switchProducts,
        fixture.productId,
        quote.defaults.switchProductId
      );
      const productId = product?.id ?? "switch_none";
      const current = switchCounts.get(productId) ?? {
        product,
        count: 0
      };
      current.count += 1;
      switchCounts.set(productId, current);
      itemCount += 1;
    }
    for (const lampId of membership.lampIdsInRoom) {
      const fixture = membership.fixtureById.get(lampId);
      if (!fixture) {
        continue;
      }
      const product = resolveQuoteCatalogItemById(
        quote.catalog.lampProducts,
        fixture.productId,
        quote.defaults.lampProductId
      );
      const productId = product?.id ?? "lamp_none";
      const current = lampCounts.get(productId) ?? {
        product,
        count: 0
      };
      current.count += 1;
      lampCounts.set(productId, current);
      itemCount += 1;
    }

    for (const row of switchCounts.values()) {
      const unitPrice = Number.isFinite(row.product?.unitPrice) ? row.product.unitPrice : 0;
      const amount = row.count * unitPrice;
      totalAmount += amount;
      rows.push({
        label: `Switches (${row.product?.name ?? "unassigned"})`,
        qtyLabel: `${row.count} pcs`,
        rateLabel: formatEstimateRate(unitPrice, "pc"),
        amount
      });
    }
    for (const row of lampCounts.values()) {
      const unitPrice = Number.isFinite(row.product?.unitPrice) ? row.product.unitPrice : 0;
      const amount = row.count * unitPrice;
      totalAmount += amount;
      rows.push({
        label: `Lamps (${row.product?.name ?? "unassigned"})`,
        qtyLabel: `${row.count} pcs`,
        rateLabel: formatEstimateRate(unitPrice, "pc"),
        amount
      });
    }

    rows.sort((left, right) => left.label.localeCompare(right.label, undefined, { sensitivity: "base" }));
    return {
      rows,
      totalAmount,
      itemCount
    };
  }

  function deriveRoomOpeningQuoteSummary(roomEntry, plan, quote) {
    const roomRectangleIdSet = new Set(
      Array.isArray(roomEntry?.rectangleIds)
        ? roomEntry.rectangleIds.filter((rectangleId) => typeof rectangleId === "string" && rectangleId)
        : []
    );
    const openings = Array.isArray(plan?.entities?.openings) ? plan.entities.openings : [];
    const doorCounts = new Map();
    let windowCount = 0;
    for (const opening of openings) {
      const hostRectangleId = normalizeRectangleIdForUi(opening?.host?.rectangleId);
      if (!hostRectangleId || !roomRectangleIdSet.has(hostRectangleId)) {
        continue;
      }
      if (opening?.kind === "window") {
        windowCount += 1;
        continue;
      }
      if (opening?.kind !== "door") {
        continue;
      }
      const product = resolveQuoteCatalogItemById(
        quote.catalog.doorProducts,
        opening.productId,
        quote.defaults.doorProductId
      );
      const productId = product?.id ?? "door_none";
      const current = doorCounts.get(productId) ?? {
        product,
        count: 0
      };
      current.count += 1;
      doorCounts.set(productId, current);
    }
    const doorRows = [];
    let totalAmount = 0;
    let doorCount = 0;
    for (const row of doorCounts.values()) {
      doorCount += row.count;
      const unitPrice = Number.isFinite(row.product?.unitPrice) ? row.product.unitPrice : 0;
      const amount = row.count * unitPrice;
      totalAmount += amount;
      doorRows.push({
        label: `Doors (${row.product?.name ?? "unassigned"})`,
        qtyLabel: `${row.count} pcs`,
        rateLabel: formatEstimateRate(unitPrice, "pc"),
        amount
      });
    }
    const windowRow = {
      label: "Windows (free)",
      qtyLabel: `${windowCount} pcs`,
      rateLabel: formatEstimateRate(0, "pc"),
      amount: 0
    };
    return {
      doorRows,
      doorCount,
      windowCount,
      windowRow,
      totalAmount
    };
  }

  function buildEstimateRowHtml(row, className = "estimate-row", wrap = false) {
    const rendered = (
      `<div class="${className}">` +
      `<span class="estimate-col-label">${escapeHtmlForOverlay(row?.label ?? "")}</span>` +
      `<span class="estimate-col-qty">${escapeHtmlForOverlay(row?.qtyLabel ?? "")}</span>` +
      `<span class="estimate-col-rate">${escapeHtmlForOverlay(row?.rateLabel ?? "")}</span>` +
      `<span class="estimate-col-amount">${formatEstimateCurrency(row?.amount)}</span>` +
      `</div>`
    );
    return wrap ? rendered : rendered;
  }

  function buildRoomInventoryDetailsHtml(activeRoom, plan, baseboard, metersPerWorldUnit) {
    const metrics = computeRoomMetrics(activeRoom, plan, baseboard, metersPerWorldUnit);
    const wallHeightMeters = getPlanWallHeightMeters(plan);
    const roomLighting = computeRoomLightingCounts(activeRoom, plan);
    const electricity = deriveRoomElectricityInventory(activeRoom, plan);
    const quote = getQuoteModel(plan);
    const roomQuote = getRoomQuoteConfig(quote, activeRoom.id);
    const flooringType = resolveQuoteCatalogItemById(
      quote.catalog.flooringTypes,
      roomQuote.flooringTypeId,
      quote.defaults.flooringTypeId
    );
    const paintingType = resolveQuoteCatalogItemById(
      quote.catalog.paintingTypes,
      roomQuote.paintingTypeId,
      quote.defaults.paintingTypeId
    );
    const flooringOptionsHtml = quote.catalog.flooringTypes.map((item) => (
      `<option value="${escapeHtmlForOverlay(item.id)}"${item.id === flooringType?.id ? " selected" : ""}>${escapeHtmlForOverlay(item.name)}</option>`
    )).join("");
    const paintingOptionsHtml = quote.catalog.paintingTypes.map((item) => (
      `<option value="${escapeHtmlForOverlay(item.id)}"${item.id === paintingType?.id ? " selected" : ""}>${escapeHtmlForOverlay(item.name)}</option>`
    )).join("");
    const flooringRate = Number.isFinite(flooringType?.materialPerM2) && Number.isFinite(flooringType?.laborPerM2)
      ? flooringType.materialPerM2 + flooringType.laborPerM2
      : null;
    const paintingRate = Number.isFinite(paintingType?.materialPerM2) && Number.isFinite(paintingType?.laborPerM2)
      ? paintingType.materialPerM2 + paintingType.laborPerM2
      : null;
    const painting = deriveRoomPaintingBreakdown(
      activeRoom,
      plan,
      baseboard,
      metersPerWorldUnit,
      wallHeightMeters
    );
    const baseboardSegments = deriveRoomBaseboardSegments(activeRoom, baseboard);
    const displayId = activeRoom.roomId ?? activeRoom.rectangleIds[0] ?? activeRoom.id;
    const displayType = activeRoom.roomId
      ? formatRoomTypeLabel(activeRoom.roomType)
      : "unassigned";
    const maxRows = 120;
    const visibleBaseboardSegments = baseboardSegments.slice(0, maxRows);
    const hiddenBaseboardCount = Math.max(0, baseboardSegments.length - visibleBaseboardSegments.length);
    const visiblePaintingRows = painting.rows.slice(0, maxRows);
    const hiddenPaintingCount = Math.max(0, painting.rows.length - visiblePaintingRows.length);

    const baseboardRowsHtml = baseboardSegments.length > 0
      ? visibleBaseboardSegments.map((segment, index) => (
        `<li>${escapeHtmlForOverlay(formatRoomBoundarySegmentLabel(segment, index + 1))}</li>`
      )).join("") + (hiddenBaseboardCount > 0 ? `<li>... ${hiddenBaseboardCount} more segments</li>` : "")
      : "<li>No baseboard segments currently derived for this room.</li>";

    const paintingRowsHtml = painting.rows.length > 0
      ? visiblePaintingRows.map((row) => (
        `<li>` +
        `${escapeHtmlForOverlay(row.label)} — ` +
        `${formatLengthLabel(row.lengthWorld, row.lengthMeters)} × ${painting.wallHeightMeters.toFixed(2)}m` +
        `${row.openingLengthWorld > 0 ? ` - opening ${formatLengthLabel(row.openingLengthWorld, row.openingLengthMeters)} × ${painting.wallHeightMeters.toFixed(2)}m` : ""}` +
        ` = ${formatAreaLabel(row.netAreaM2)}` +
        `</li>`
      )).join("") + (hiddenPaintingCount > 0 ? `<li>... ${hiddenPaintingCount} more rows</li>` : "")
      : "<li>No boundary segments available for painting preview.</li>";
    const paintingWarningHtml = painting.openingModelWarning
      ? `<div class="room-package-note">${escapeHtmlForOverlay(painting.openingModelWarning)}</div>`
      : "";

    const groupRowsHtml = electricity.groups.length > 0
      ? electricity.groups.map((group) => {
        const linkedSwitchCount = group.linkedSwitchIds.length;
        return `<li>${escapeHtmlForOverlay(group.name)} — lamps ${group.lampIds.length}, switches ${linkedSwitchCount}</li>`;
      }).join("")
      : "<li>No link groups yet. Use Link Lights: click switch, click lamps.</li>";

    const integrityNotes = [];
    if (electricity.switchIdsWithNoLinks.length > 0) {
      integrityNotes.push(`${electricity.switchIdsWithNoLinks.length} switch${electricity.switchIdsWithNoLinks.length === 1 ? "" : "es"} with no links`);
    }
    if (electricity.orphanLampIds.length > 0) {
      integrityNotes.push(`${electricity.orphanLampIds.length} lamp${electricity.orphanLampIds.length === 1 ? "" : "s"} without switch control`);
    }
    const integrityLabel = integrityNotes.length > 0 ? integrityNotes.join(" • ") : "No obvious lighting link gaps";
    const roomQuoteFieldRoomId = escapeHtmlForOverlay(activeRoom.id);
    const includeBaseboardChecked = roomQuote.includeBaseboard ? " checked" : "";

    return (
      `<div class="room-tree-meta">` +
      `ID ${escapeHtmlForOverlay(displayId)} • Type ${escapeHtmlForOverlay(displayType)} • Rectangles ${activeRoom.rectangleIds.length} • Subtypes ${escapeHtmlForOverlay(formatLightingSubtypeCounts(roomLighting.subtypeCounts) || "none")}` +
      `</div>` +
      `<details class="room-package">` +
      `<summary>Quote Settings — flooring ${escapeHtmlForOverlay(flooringType?.name ?? "n/a")} • painting ${escapeHtmlForOverlay(paintingType?.name ?? "n/a")} • baseboard ${roomQuote.includeBaseboard ? "on" : "off"}</summary>` +
      `<div class="room-package-body room-quote-controls">` +
      `<label class="room-inline-field">` +
      `<input type="checkbox" data-room-quote-room-id="${roomQuoteFieldRoomId}" data-room-quote-field="includeBaseboard"${includeBaseboardChecked}>` +
      `<span>Include baseboard in quote</span>` +
      `</label>` +
      `<label class="room-inline-field">` +
      `<span>Flooring type</span>` +
      `<select data-room-quote-room-id="${roomQuoteFieldRoomId}" data-room-quote-field="flooringTypeId">${flooringOptionsHtml}</select>` +
      `</label>` +
      `<label class="room-inline-field">` +
      `<span>Painting type</span>` +
      `<select data-room-quote-room-id="${roomQuoteFieldRoomId}" data-room-quote-field="paintingTypeId">${paintingOptionsHtml}</select>` +
      `</label>` +
      `</div>` +
      `</details>` +
      `<details class="room-package">` +
      `<summary>Baseboard — ${escapeHtmlForOverlay(metrics.baseboardLabel)} (${baseboardSegments.length} seg)</summary>` +
      `<div class="room-package-body"><div class="room-inline-note">Quote: ${roomQuote.includeBaseboard ? "included" : "excluded"}.</div><ol class="room-lines">${baseboardRowsHtml}</ol></div>` +
      `</details>` +
      `<details class="room-package">` +
      `<summary>Flooring — ${escapeHtmlForOverlay(metrics.areaLabel)} (${escapeHtmlForOverlay(flooringType?.name ?? "n/a")})</summary>` +
      `<div class="room-package-body">Rate: ${Number.isFinite(flooringRate) ? formatEstimateRate(flooringRate, "m²") : "n/a"} (material + work).</div>` +
      `</details>` +
      `<details class="room-package">` +
      `<summary>Painting — ${formatAreaLabel(painting.totalAreaM2)} (${escapeHtmlForOverlay(paintingType?.name ?? "n/a")}) (h=${painting.wallHeightMeters.toFixed(2)}m${Number.isFinite(painting.totalOpeningAreaM2) && painting.totalOpeningAreaM2 > 0 ? `, openings -${painting.totalOpeningAreaM2.toFixed(2)} m²` : ""})</summary>` +
      `<div class="room-package-body">${paintingWarningHtml}<ol class="room-lines">${paintingRowsHtml}</ol></div>` +
      `</details>` +
      `<details class="room-package">` +
      `<summary>Electricity — switches ${roomLighting.switchCount}, lamps ${roomLighting.lampCount}, groups ${roomLighting.groupCount}, links ${roomLighting.linkCount}</summary>` +
      `<div class="room-package-body">` +
      `<div class="room-inline-note">Integrity: ${escapeHtmlForOverlay(integrityLabel)}</div>` +
      `<details class="room-subpackage">` +
      `<summary>Sockets (${electricity.sockets.length})</summary>` +
      `<div class="room-package-body">No sockets model yet.</div>` +
      `</details>` +
      `<details class="room-subpackage">` +
      `<summary>Lighting Groups (${electricity.groups.length})</summary>` +
      `<div class="room-package-body"><ul class="room-lines">${groupRowsHtml}</ul>` +
      `<div class="room-inline-note">Linked lamps: ${electricity.controlledLampIds.length}/${electricity.lamps.length}</div>` +
      `</div>` +
      `</details>` +
      `</div>` +
      `</details>`
    );
  }

  function formatRoomBoundarySegmentLabel(segment, index) {
    const side = typeof segment?.side === "string" ? segment.side : "?";
    const rectangleId = typeof segment?.rectangleId === "string" ? segment.rectangleId : "rect";
    const x0 = Number.isFinite(segment?.x0) ? segment.x0.toFixed(1) : "?";
    const y0 = Number.isFinite(segment?.y0) ? segment.y0.toFixed(1) : "?";
    const x1 = Number.isFinite(segment?.x1) ? segment.x1.toFixed(1) : "?";
    const y1 = Number.isFinite(segment?.y1) ? segment.y1.toFixed(1) : "?";
    const worldLength = Number.isFinite(segment?.lengthWorld) ? segment.lengthWorld.toFixed(1) : "?";
    const meterLength = Number.isFinite(segment?.lengthMeters) ? segment.lengthMeters.toFixed(2) : null;
    const lengthLabel = meterLength != null ? `${meterLength}m` : `${worldLength}wu`;
    return `${index}. ${rectangleId}:${side} (${x0},${y0}→${x1},${y1}) = ${lengthLabel}`;
  }

  function formatLengthLabel(lengthWorld, lengthMeters) {
    if (Number.isFinite(lengthMeters)) {
      return `${lengthMeters.toFixed(2)}m`;
    }
    if (Number.isFinite(lengthWorld)) {
      return `${lengthWorld.toFixed(1)}wu`;
    }
    return "n/a";
  }

  function formatAreaLabel(areaM2) {
    if (Number.isFinite(areaM2)) {
      return `${areaM2.toFixed(2)} m²`;
    }
    return "n/a";
  }

  function formatEstimateCurrency(amount) {
    if (!Number.isFinite(amount)) {
      return "—";
    }
    return `${ESTIMATE_CURRENCY_SYMBOL}${amount.toFixed(2)}`;
  }

  function formatEstimateRate(rate, unit) {
    if (!Number.isFinite(rate)) {
      return "—";
    }
    return `${ESTIMATE_CURRENCY_SYMBOL}${rate.toFixed(2)}/${unit}`;
  }

  function commitScaleCalibrationDraft(draft, currentScale) {
    if (!draft) {
      return false;
    }

    const startWorld = draft.startWorld;
    const endWorld = draft.currentWorld;
    const worldLength = distanceBetweenWorldPoints(startWorld, endWorld);
    if (!Number.isFinite(worldLength) || worldLength < MIN_CALIBRATION_LINE_WORLD) {
      return false;
    }

    const suggestedMeters = currentScale?.referenceLine?.meters;
    const promptDefault = Number.isFinite(suggestedMeters) ? String(suggestedMeters) : "";
    const input = window.prompt(
      "Enter real-world length for the calibration line (meters):",
      promptDefault
    );
    if (input == null) {
      return false;
    }

    const meters = Number.parseFloat(String(input).trim());
    const calibration = buildScaleCalibration(startWorld, endWorld, meters);
    if (!calibration) {
      window.alert("Please enter a positive number of meters.");
      return false;
    }

    store.dispatch({
      type: "plan/scale/setCalibration",
      referenceLine: calibration.referenceLine,
      metersPerWorldUnit: calibration.metersPerWorldUnit
    });
    return true;
  }

  function calibrateScaleByActiveRoomArea() {
    const snapshot = store.getState();
    const activeRoomEntry = getActiveRoomEntry(snapshot.plan, snapshot.editorState);
    if (!activeRoomEntry) {
      return false;
    }

    const metrics = computeRoomMetrics(activeRoomEntry, snapshot.plan, null, snapshot.plan.scale?.metersPerWorldUnit);
    if (!Number.isFinite(metrics.areaWorld) || metrics.areaWorld <= 0) {
      window.alert("Selected room has no measurable area.");
      return false;
    }

    const promptDefault = Number.isFinite(metrics.areaM2) && metrics.areaM2 > 0
      ? metrics.areaM2.toFixed(2)
      : "";
    const input = window.prompt(
      `Enter real-world area for "${activeRoomEntry.name}" (m²):`,
      promptDefault
    );
    if (input == null) {
      return false;
    }

    const parsed = Number.parseFloat(String(input).trim().replace(",", "."));
    const metersPerWorldUnit = computeMetersPerWorldUnitFromArea(metrics.areaWorld, parsed);
    if (!Number.isFinite(metersPerWorldUnit) || metersPerWorldUnit <= 0) {
      window.alert("Please enter a positive area in square meters.");
      return false;
    }

    store.dispatch({
      type: "plan/scale/setMetersPerWorldUnit",
      metersPerWorldUnit
    });
    syncEditorChrome();
    return true;
  }
}

function toCanvasLocalPoint(canvas, clientX, clientY) {
  const rect = canvas.getBoundingClientRect();
  return {
    x: clientX - rect.left,
    y: clientY - rect.top
  };
}

function deriveNextUserRectangleId(plan) {
  let maxNumericId = 0;
  for (const rectangle of plan.entities.rectangles) {
    const match = /^rect_user_(\d+)$/.exec(rectangle.id);
    if (!match) {
      continue;
    }
    const numericId = Number.parseInt(match[1], 10);
    if (Number.isFinite(numericId)) {
      maxNumericId = Math.max(maxNumericId, numericId);
    }
  }
  return maxNumericId + 1;
}

function deriveNextUserFixtureId(plan) {
  const fixtures = getLightingCollections(plan).fixtures;
  let maxNumericId = 0;
  for (const fixture of fixtures) {
    const match = /^fx_user_(\d+)$/.exec(fixture?.id);
    if (!match) {
      continue;
    }
    const numericId = Number.parseInt(match[1], 10);
    if (Number.isFinite(numericId)) {
      maxNumericId = Math.max(maxNumericId, numericId);
    }
  }
  return maxNumericId + 1;
}

function deriveNextUserOpeningId(plan) {
  const openings = Array.isArray(plan?.entities?.openings) ? plan.entities.openings : [];
  let maxNumericId = 0;
  for (const opening of openings) {
    const match = /^op_user_(\d+)$/.exec(opening?.id);
    if (!match) {
      continue;
    }
    const numericId = Number.parseInt(match[1], 10);
    if (Number.isFinite(numericId)) {
      maxNumericId = Math.max(maxNumericId, numericId);
    }
  }
  return maxNumericId + 1;
}

function shouldIgnoreGlobalKeyDown(event) {
  if (event.defaultPrevented || event.metaKey || event.ctrlKey || event.altKey) {
    return true;
  }

  const target = event.target;
  if (!target || !(target instanceof HTMLElement)) {
    return false;
  }

  if (target.isContentEditable) {
    return true;
  }

  const tagName = target.tagName;
  return tagName === "INPUT" || tagName === "TEXTAREA" || tagName === "SELECT";
}

function describeLoadSource(loadSource) {
  switch (loadSource) {
    case "localStorage":
      return "saved local plan";
    case "none":
      return "default sample plan";
    case "storage-unavailable":
      return "default plan (local storage unavailable)";
    case "parse-error":
      return "default plan (saved JSON invalid)";
    case "invalid-plan":
      return "default plan (saved plan invalid)";
    case "storage-read-error":
      return "default plan (storage read error)";
    default:
      return "default plan";
  }
}

function formatAutosaveStatusShort(status) {
  if (!status || status.phase === "disabled") {
    return "autosave disabled";
  }
  if (status.phase === "error") {
    return "autosave error";
  }
  if (status.phase === "scheduled") {
    return "autosave pending";
  }
  if (status.phase === "saved") {
    return `autosave saved ${formatTimeCompact(status.lastSavedAt)}`;
  }
  return "autosave idle";
}

function formatAutosaveStatusDetail(status) {
  if (!status || status.phase === "disabled") {
    return "disabled";
  }
  if (status.phase === "error") {
    return `error${status.errorMessage ? ` (${status.errorMessage})` : ""}`;
  }
  if (status.phase === "scheduled") {
    return `pending${status.lastActionType ? ` after ${status.lastActionType}` : ""}`;
  }
  if (status.phase === "saved") {
    const time = formatTimeCompact(status.lastSavedAt);
    return `saved${time ? ` at ${time}` : ""}${status.lastActionType ? ` after ${status.lastActionType}` : ""}`;
  }
  return "idle";
}

function formatTimeCompact(isoString) {
  if (!isoString) {
    return "";
  }
  const date = new Date(isoString);
  if (Number.isNaN(date.getTime())) {
    return "";
  }
  return date.toLocaleTimeString([], {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit"
  });
}

function formatBackgroundShort(background, backgroundImageState) {
  const opacityPercent = Math.round((background?.opacity ?? 0) * 100);
  const imageStatus = formatBackgroundImageStatus(backgroundImageState);
  return `bg ${opacityPercent}% (${imageStatus})`;
}

function formatScaleShort(scale) {
  const metersPerWorldUnit = scale?.metersPerWorldUnit;
  if (!Number.isFinite(metersPerWorldUnit) || metersPerWorldUnit <= 0) {
    return "scale none";
  }
  return `${metersPerWorldUnit.toFixed(4)} m/unit`;
}

function formatScaleToolbarStatus(scale) {
  const metersPerWorldUnit = scale?.metersPerWorldUnit;
  if (!Number.isFinite(metersPerWorldUnit) || metersPerWorldUnit <= 0) {
    return "Scale not calibrated";
  }

  const meters = scale.referenceLine?.meters;
  const refLabel = Number.isFinite(meters) ? `${meters}m ref` : "no ref";
  return `Scale ${metersPerWorldUnit.toFixed(4)} m/u (${refLabel})`;
}

function formatScaleDetail(scale) {
  const metersPerWorldUnit = scale?.metersPerWorldUnit;
  const referenceLine = scale?.referenceLine;
  if (!Number.isFinite(metersPerWorldUnit) || metersPerWorldUnit <= 0) {
    return "Scale not calibrated yet";
  }
  if (!referenceLine) {
    return `Scale ${metersPerWorldUnit.toFixed(5)} m/unit (calibrated without reference line)`;
  }

  const worldLength = Math.hypot(referenceLine.x1 - referenceLine.x0, referenceLine.y1 - referenceLine.y0);
  return `Scale ${metersPerWorldUnit.toFixed(5)} m/unit from ${referenceLine.meters}m over ${worldLength.toFixed(1)} world units`;
}

function formatSelectedRectangleDimensionsWorld(rectangle) {
  if (!rectangle) {
    return "none";
  }
  return `${rectangle.w.toFixed(1)} x ${rectangle.h.toFixed(1)} wu`;
}

function formatSelectedRectangleDimensionsMetric(rectangle, scale) {
  if (!rectangle) {
    return "none";
  }

  const metersPerWorldUnit = scale?.metersPerWorldUnit;
  const widthMeters = worldLengthToMeters(rectangle.w, metersPerWorldUnit);
  const heightMeters = worldLengthToMeters(rectangle.h, metersPerWorldUnit);
  if (widthMeters == null || heightMeters == null) {
    return "set scale to view meters/cm";
  }

  const widthLabel = formatMetersAndCentimeters(widthMeters, { metersDecimals: 2, centimetersDecimals: 1 });
  const heightLabel = formatMetersAndCentimeters(heightMeters, { metersDecimals: 2, centimetersDecimals: 1 });
  return `${widthLabel} x ${heightLabel}`;
}

function formatSelectedRectangleDimensionsStatus(rectangle, scale) {
  if (!rectangle) {
    return "";
  }

  const metersPerWorldUnit = scale?.metersPerWorldUnit;
  const widthMeters = worldLengthToMeters(rectangle.w, metersPerWorldUnit);
  const heightMeters = worldLengthToMeters(rectangle.h, metersPerWorldUnit);
  if (widthMeters == null || heightMeters == null) {
    return `${rectangle.w.toFixed(1)}x${rectangle.h.toFixed(1)}wu`;
  }

  return `${widthMeters.toFixed(2)}m x ${heightMeters.toFixed(2)}m`;
}

function formatSelectedRectangleDimensionsOverlay(rectangle, scale) {
  if (!rectangle) {
    return "none";
  }

  const worldLabel = `${rectangle.w.toFixed(1)} x ${rectangle.h.toFixed(1)} world units`;
  const metricLabel = formatSelectedRectangleDimensionsMetric(rectangle, scale);
  return `${worldLabel}; ${metricLabel}`;
}

function formatSelectedRectangleKindStatus(rectangle) {
  if (!rectangle) {
    return "";
  }
  return rectangle.kind === "wallRect" ? "wallRect" : "roomRect";
}

function formatSelectedRectangleKindOverlay(rectangle) {
  if (!rectangle) {
    return "none";
  }
  return rectangle.kind === "wallRect" ? "wallRect (whole wall primitive)" : "roomRect (room interior)";
}

function formatSelectedRectangleRoomTagStatus(rectangle, plan) {
  if (!rectangle || rectangle.kind === "wallRect") {
    return "";
  }
  const room = getRoomForRectangle(plan, rectangle);
  if (!room) {
    return "room:unassigned";
  }
  return `room:${room.name}/${formatRoomTypeLabel(room.roomType)}`;
}

function formatSelectedRectangleRoomTagOverlay(rectangle, plan) {
  if (!rectangle) {
    return "none";
  }
  if (rectangle.kind === "wallRect") {
    return "n/a for wallRect";
  }
  const room = getRoomForRectangle(plan, rectangle);
  if (!room) {
    return "unassigned";
  }
  return `${escapeHtmlForOverlay(room.name)} (${formatRoomTypeLabel(room.roomType)}) [${room.id}]`;
}

function deriveRoomBaseboardSegments(roomEntry, baseboard) {
  if (!roomEntry) {
    return [];
  }
  const segments = Array.isArray(baseboard?.segments) ? baseboard.segments : [];
  const roomRectangleIdSet = new Set(
    Array.isArray(roomEntry?.rectangleIds)
      ? roomEntry.rectangleIds.filter((rectangleId) => typeof rectangleId === "string" && rectangleId)
      : []
  );
  const roomId = normalizeRectangleIdForUi(roomEntry.roomId);
  return segments.filter((segment) => {
    if (!segment) {
      return false;
    }
    if (roomId) {
      return segment.roomId === roomId;
    }
    return roomRectangleIdSet.has(segment.rectangleId) && segment.roomId == null;
  });
}

function computeRoomMetrics(roomEntry, plan, baseboard, metersPerWorldUnit) {
  const rectangleById = new Map(
    (Array.isArray(plan?.entities?.rectangles) ? plan.entities.rectangles : []).map((rectangle) => [rectangle.id, rectangle])
  );
  let areaWorld = 0;
  for (const rectangleId of roomEntry.rectangleIds) {
    const rectangle = rectangleById.get(rectangleId);
    if (!rectangle || rectangle.kind === "wallRect") {
      continue;
    }
    areaWorld += rectangle.w * rectangle.h;
  }

  const segments = deriveRoomBaseboardSegments(roomEntry, baseboard);
  let baseboardWorld = 0;
  for (const segment of segments) {
    if (Number.isFinite(segment.lengthWorld)) {
      baseboardWorld += segment.lengthWorld;
    }
  }

  const areaM2 = Number.isFinite(metersPerWorldUnit) && metersPerWorldUnit > 0
    ? areaWorld * metersPerWorldUnit * metersPerWorldUnit
    : null;
  const baseboardMeters = Number.isFinite(metersPerWorldUnit) && metersPerWorldUnit > 0
    ? baseboardWorld * metersPerWorldUnit
    : null;

  return {
    areaWorld,
    areaM2,
    baseboardWorld,
    baseboardMeters,
    areaLabel: areaM2 == null ? `${areaWorld.toFixed(1)} wu²` : `${areaM2.toFixed(2)} m² (${areaWorld.toFixed(1)} wu²)`,
    baseboardLabel: baseboardMeters == null
      ? `${baseboardWorld.toFixed(1)} wu`
      : `${baseboardMeters.toFixed(2)} m (${baseboardWorld.toFixed(1)} wu)`
  };
}

function getPlanWallHeightMeters(plan) {
  const wallHeight = Number.isFinite(plan?.settings?.wallHeightMeters)
    ? plan.settings.wallHeightMeters
    : DEFAULT_PAINT_WALL_HEIGHT_METERS;
  return wallHeight > 0 ? wallHeight : DEFAULT_PAINT_WALL_HEIGHT_METERS;
}

function computeRoomsAggregateMetrics(roomEntries, plan, baseboard, metersPerWorldUnit, wallHeightMeters = null) {
  const entries = Array.isArray(roomEntries) ? roomEntries : [];
  let areaWorld = 0;
  let baseboardWorld = 0;
  let paintingAreaM2 = 0;
  let hasPaintingArea = false;
  const effectiveWallHeight = Number.isFinite(wallHeightMeters) && wallHeightMeters > 0
    ? wallHeightMeters
    : getPlanWallHeightMeters(plan);
  for (const roomEntry of entries) {
    const metrics = computeRoomMetrics(roomEntry, plan, baseboard, metersPerWorldUnit);
    areaWorld += metrics.areaWorld;
    baseboardWorld += metrics.baseboardWorld;
    const painting = deriveRoomPaintingBreakdown(
      roomEntry,
      plan,
      baseboard,
      metersPerWorldUnit,
      effectiveWallHeight
    );
    if (Number.isFinite(painting.totalAreaM2)) {
      paintingAreaM2 += painting.totalAreaM2;
      hasPaintingArea = true;
    }
  }

  const areaM2 = Number.isFinite(metersPerWorldUnit) && metersPerWorldUnit > 0
    ? areaWorld * metersPerWorldUnit * metersPerWorldUnit
    : null;
  const baseboardMeters = Number.isFinite(metersPerWorldUnit) && metersPerWorldUnit > 0
    ? baseboardWorld * metersPerWorldUnit
    : null;

  return {
    areaWorld,
    areaM2,
    baseboardWorld,
    baseboardMeters,
    paintingAreaM2: hasPaintingArea ? paintingAreaM2 : null,
    wallHeightMeters: effectiveWallHeight,
    areaLabel: areaM2 == null ? `${areaWorld.toFixed(1)} wu²` : `${areaM2.toFixed(2)} m² (${areaWorld.toFixed(1)} wu²)`,
    baseboardLabel: baseboardMeters == null
      ? `${baseboardWorld.toFixed(1)} wu`
      : `${baseboardMeters.toFixed(2)} m (${baseboardWorld.toFixed(1)} wu)`,
    paintingAreaLabel: hasPaintingArea
      ? `${paintingAreaM2.toFixed(2)} m²`
      : "set scale"
  };
}

function deriveRoomPaintingBreakdown(roomEntry, plan, baseboard, metersPerWorldUnit, wallHeightMeters = DEFAULT_PAINT_WALL_HEIGHT_METERS) {
  const segments = deriveRoomBaseboardSegments(roomEntry, baseboard).slice();
  const validWallHeight = Number.isFinite(wallHeightMeters) && wallHeightMeters > 0
    ? wallHeightMeters
    : DEFAULT_PAINT_WALL_HEIGHT_METERS;
  const openingIntervalsBySide = deriveRoomOpeningIntervalsBySide(roomEntry, plan);
  const hasOpeningModel = Array.isArray(plan?.entities?.openings);
  const rows = segments.map((segment, index) => {
    const lengthWorld = Number.isFinite(segment?.lengthWorld) ? segment.lengthWorld : 0;
    const lengthMeters = Number.isFinite(metersPerWorldUnit) && metersPerWorldUnit > 0
      ? lengthWorld * metersPerWorldUnit
      : null;
    const openingLengthWorld = sumOpeningOverlapOnSegment(segment, openingIntervalsBySide);
    const netLengthWorld = Math.max(0, lengthWorld - openingLengthWorld);
    const openingLengthMeters = Number.isFinite(metersPerWorldUnit) && metersPerWorldUnit > 0
      ? openingLengthWorld * metersPerWorldUnit
      : null;
    const grossAreaM2 = lengthMeters != null ? lengthMeters * validWallHeight : null;
    const openingAreaM2 = openingLengthMeters != null ? openingLengthMeters * validWallHeight : null;
    const netAreaM2 = grossAreaM2 != null
      ? Math.max(0, grossAreaM2 - (openingAreaM2 ?? 0))
      : null;
    return {
      id: `${segment?.id ?? "seg"}:${index + 1}`,
      label: `${segment?.rectangleId ?? "rect"}:${segment?.side ?? "?"}`,
      lengthWorld,
      lengthMeters,
      openingLengthWorld,
      openingLengthMeters,
      netLengthWorld,
      grossAreaM2,
      openingAreaM2,
      netAreaM2,
      areaM2: netAreaM2
    };
  });
  const hasGrossArea = rows.some((row) => Number.isFinite(row.grossAreaM2));
  const hasOpeningArea = rows.some((row) => Number.isFinite(row.openingAreaM2));
  const hasNetArea = rows.some((row) => Number.isFinite(row.netAreaM2));
  const totalGrossAreaM2 = hasGrossArea
    ? rows.reduce((sum, row) => sum + (row.grossAreaM2 ?? 0), 0)
    : null;
  const totalOpeningAreaM2 = hasOpeningArea
    ? rows.reduce((sum, row) => sum + (row.openingAreaM2 ?? 0), 0)
    : null;
  const totalAreaM2 = hasNetArea
    ? rows.reduce((sum, row) => sum + (row.netAreaM2 ?? 0), 0)
    : null;
  return {
    wallHeightMeters: validWallHeight,
    hasOpeningModel,
    openingModelWarning: hasOpeningModel ? null : "Openings model missing; paint subtraction is not available.",
    rows,
    totalGrossAreaM2,
    totalOpeningAreaM2,
    totalAreaM2
  };
}

function deriveRoomOpeningIntervalsBySide(roomEntry, plan) {
  const intervalsBySide = new Map();
  if (!roomEntry || !plan) {
    return intervalsBySide;
  }
  const roomRectangleIdSet = new Set(
    Array.isArray(roomEntry.rectangleIds)
      ? roomEntry.rectangleIds.filter((rectangleId) => typeof rectangleId === "string" && rectangleId)
      : []
  );
  if (roomRectangleIdSet.size === 0) {
    return intervalsBySide;
  }

  const rectangles = Array.isArray(plan?.entities?.rectangles) ? plan.entities.rectangles : [];
  const rectangleById = new Map(rectangles.map((rectangle) => [rectangle.id, rectangle]));
  const openings = Array.isArray(plan?.entities?.openings) ? plan.entities.openings : [];
  for (const opening of openings) {
    const host = opening?.host;
    const rectangleId = normalizeRectangleIdForUi(host?.rectangleId);
    const side = normalizeWallSideForUi(host?.side);
    if (!rectangleId || !side || !roomRectangleIdSet.has(rectangleId)) {
      continue;
    }
    const rectangle = rectangleById.get(rectangleId);
    if (!rectangle) {
      continue;
    }
    const interval = deriveOpeningIntervalOnSide(rectangle, opening, side);
    if (!interval) {
      continue;
    }
    const sideKey = `${rectangleId}:${side}`;
    if (!intervalsBySide.has(sideKey)) {
      intervalsBySide.set(sideKey, []);
    }
    intervalsBySide.get(sideKey).push(interval);
  }

  for (const [sideKey, intervals] of intervalsBySide.entries()) {
    intervalsBySide.set(sideKey, mergeSimpleIntervals(intervals));
  }
  return intervalsBySide;
}

function deriveOpeningIntervalOnSide(rectangle, opening, side) {
  if (!rectangle || !opening || !side) {
    return null;
  }
  const sideLength = side === "top" || side === "bottom" ? rectangle.w : rectangle.h;
  if (!Number.isFinite(sideLength) || sideLength <= 0) {
    return null;
  }
  const minWidth = Math.max(1, Math.min(MIN_OPENING_WIDTH_WORLD, sideLength));
  const openingWidth = clampScreenValue(
    Number.isFinite(opening.widthWorld) ? opening.widthWorld : DEFAULT_OPENING_WIDTH_WORLD,
    minWidth,
    sideLength
  );
  const halfWidth = openingWidth / 2;
  const offset = Number.isFinite(opening?.host?.offset) ? opening.host.offset : 0.5;
  const centerAlong = clampScreenValue(offset * sideLength, halfWidth, sideLength - halfWidth);
  const sideStart = side === "top" || side === "bottom" ? rectangle.x : rectangle.y;
  return {
    start: sideStart + centerAlong - halfWidth,
    end: sideStart + centerAlong + halfWidth
  };
}

function mergeSimpleIntervals(intervals) {
  if (!Array.isArray(intervals) || intervals.length === 0) {
    return [];
  }
  const normalized = intervals
    .filter((interval) => Number.isFinite(interval?.start) && Number.isFinite(interval?.end) && interval.end > interval.start)
    .sort((left, right) => left.start - right.start || left.end - right.end);
  if (normalized.length === 0) {
    return [];
  }
  const merged = [normalized[0]];
  for (let index = 1; index < normalized.length; index += 1) {
    const current = normalized[index];
    const last = merged[merged.length - 1];
    if (current.start <= last.end) {
      last.end = Math.max(last.end, current.end);
    } else {
      merged.push(current);
    }
  }
  return merged;
}

function sumOpeningOverlapOnSegment(segment, openingIntervalsBySide) {
  const rectangleId = normalizeRectangleIdForUi(segment?.rectangleId);
  const side = normalizeWallSideForUi(segment?.side);
  if (!rectangleId || !side) {
    return 0;
  }
  const sideKey = `${rectangleId}:${side}`;
  const intervals = openingIntervalsBySide.get(sideKey);
  if (!Array.isArray(intervals) || intervals.length === 0) {
    return 0;
  }
  const segmentStart = side === "top" || side === "bottom"
    ? Math.min(segment.x0, segment.x1)
    : Math.min(segment.y0, segment.y1);
  const segmentEnd = side === "top" || side === "bottom"
    ? Math.max(segment.x0, segment.x1)
    : Math.max(segment.y0, segment.y1);
  if (!Number.isFinite(segmentStart) || !Number.isFinite(segmentEnd) || segmentEnd <= segmentStart) {
    return 0;
  }

  let overlap = 0;
  for (const interval of intervals) {
    const start = Math.max(segmentStart, interval.start);
    const end = Math.min(segmentEnd, interval.end);
    if (end > start) {
      overlap += end - start;
    }
  }
  return Math.min(overlap, Math.max(0, segmentEnd - segmentStart));
}

function computeLightingTotals(plan) {
  const lighting = getLightingCollections(plan);
  const fixtureById = new Map(
    lighting.fixtures
      .filter((fixture) => typeof fixture?.id === "string" && fixture.id)
      .map((fixture) => [fixture.id, fixture])
  );
  const validLinks = collectValidLampLinks(lighting.links, fixtureById);
  let switchCount = 0;
  let lampCount = 0;
  const subtypeCounts = {};
  for (const fixture of lighting.fixtures) {
    if (fixture?.kind === "switch") {
      switchCount += 1;
    } else if (fixture?.kind === "lamp") {
      lampCount += 1;
    }
    const subtype = typeof fixture?.subtype === "string" && fixture.subtype
      ? fixture.subtype
      : (fixture?.kind === "switch" ? "switch_single" : "lamp");
    subtypeCounts[subtype] = (subtypeCounts[subtype] ?? 0) + 1;
  }
  return {
    switchCount,
    lampCount,
    groupCount: deriveLightingGroupsFromLinks(validLinks, fixtureById).length,
    linkCount: validLinks.length,
    subtypeCounts
  };
}

function computeRoomLightingCounts(roomEntry, plan) {
  const membership = deriveRoomLightingMembership(roomEntry, plan);
  const subtypeCounts = {};
  let switchCount = 0;
  let lampCount = 0;
  for (const fixtureId of membership.fixtureIdsInRoom) {
    const fixture = membership.fixtureById.get(fixtureId);
    if (!fixture) {
      continue;
    }
    if (fixture.kind === "switch") {
      switchCount += 1;
    } else if (fixture.kind === "lamp") {
      lampCount += 1;
    }
    const subtype = typeof fixture?.subtype === "string" && fixture.subtype
      ? fixture.subtype
      : (fixture?.kind === "switch" ? "switch_single" : "lamp");
    subtypeCounts[subtype] = (subtypeCounts[subtype] ?? 0) + 1;
  }

  return {
    switchCount,
    lampCount,
    groupCount: deriveLightingGroupsFromLinks(
      membership.linksInRoom,
      membership.fixtureById,
      membership.lampIdsInRoom
    ).length,
    linkCount: membership.linksInRoom.length,
    subtypeCounts
  };
}

function collectValidLampLinks(links, fixtureById) {
  if (!Array.isArray(links) || !(fixtureById instanceof Map)) {
    return [];
  }
  const dedupe = new Set();
  const validLinks = [];
  for (const link of links) {
    if (link?.targetType !== "lamp") {
      continue;
    }
    const switchId = normalizeRectangleIdForUi(link?.switchId);
    const targetLampId = normalizeRectangleIdForUi(link?.targetId);
    if (!switchId || !targetLampId) {
      continue;
    }
    const switchFixture = fixtureById.get(switchId);
    const lampFixture = fixtureById.get(targetLampId);
    if (switchFixture?.kind !== "switch" || lampFixture?.kind !== "lamp") {
      continue;
    }
    const edgeKey = `${switchId}|${targetLampId}`;
    if (dedupe.has(edgeKey)) {
      continue;
    }
    dedupe.add(edgeKey);
    validLinks.push({
      switchId,
      targetType: "lamp",
      targetId: targetLampId
    });
  }
  return validLinks;
}

function deriveLightingGroupsFromLinks(links, fixtureById, allowedLampIds = null) {
  if (!(fixtureById instanceof Map)) {
    return [];
  }
  const linkList = collectValidLampLinks(links, fixtureById);
  const lampIdFilter = allowedLampIds instanceof Set ? allowedLampIds : null;
  const groupsBySwitchId = new Map();
  for (const link of linkList) {
    const switchId = link.switchId;
    const lampId = link.targetId;
    if (lampIdFilter && !lampIdFilter.has(lampId)) {
      continue;
    }
    if (!groupsBySwitchId.has(switchId)) {
      groupsBySwitchId.set(switchId, new Set());
    }
    groupsBySwitchId.get(switchId).add(lampId);
  }
  return Array.from(groupsBySwitchId.entries())
    .map(([switchId, lampIdSet]) => ({
      id: `switch:${switchId}`,
      name: `Switch ${switchId}`,
      switchId,
      lampIds: Array.from(lampIdSet),
      linkedSwitchIds: [switchId]
    }))
    .sort((left, right) => left.name.localeCompare(right.name, undefined, { sensitivity: "base" }));
}

function isFixtureInRoomEntry(fixture, roomId, roomRectangleIdSet, rectangles) {
  if (!fixture || typeof fixture?.id !== "string" || !fixture.id) {
    return false;
  }

  const hostRectangleId = normalizeRectangleIdForUi(fixture?.host?.rectangleId);
  if (hostRectangleId && roomRectangleIdSet.has(hostRectangleId)) {
    return true;
  }

  const fixtureRoomId = normalizeRectangleIdForUi(fixture?.roomId);
  if (roomId && fixtureRoomId === roomId) {
    return true;
  }
  if (!roomId && fixtureRoomId) {
    return false;
  }

  if (Number.isFinite(fixture?.x) && Number.isFinite(fixture?.y)) {
    const topRectangleAtFixture = findRoomRectangleAtPoint(rectangles, {
      x: fixture.x,
      y: fixture.y
    });
    if (topRectangleAtFixture && roomRectangleIdSet.has(topRectangleAtFixture.id)) {
      return true;
    }
  }

  return false;
}

function deriveRoomLightingMembership(roomEntry, plan) {
  const lighting = getLightingCollections(plan);
  const roomId = normalizeRectangleIdForUi(roomEntry?.roomId);
  const roomRectangleIdSet = new Set(
    Array.isArray(roomEntry?.rectangleIds)
      ? roomEntry.rectangleIds.filter((rectangleId) => typeof rectangleId === "string" && rectangleId)
      : []
  );
  const rectangles = Array.isArray(plan?.entities?.rectangles) ? plan.entities.rectangles : [];
  const fixtureById = new Map(
    lighting.fixtures
      .filter((fixture) => typeof fixture?.id === "string" && fixture.id)
      .map((fixture) => [fixture.id, fixture])
  );
  const fixtureIdsInRoom = new Set();
  for (const fixture of fixtureById.values()) {
    if (!isFixtureInRoomEntry(fixture, roomId, roomRectangleIdSet, rectangles)) {
      continue;
    }
    fixtureIdsInRoom.add(fixture.id);
  }

  const switchIds = new Set();
  const lampIds = new Set();
  for (const fixtureId of fixtureIdsInRoom) {
    const fixture = fixtureById.get(fixtureId);
    if (fixture?.kind === "switch") {
      switchIds.add(fixtureId);
    } else if (fixture?.kind === "lamp") {
      lampIds.add(fixtureId);
    }
  }

  const linksInRoom = [];
  for (const link of lighting.links) {
    if (link?.targetType !== "lamp") {
      continue;
    }
    const switchId = normalizeRectangleIdForUi(link?.switchId);
    const lampId = normalizeRectangleIdForUi(link?.targetId);
    if (!switchId || !lampId) {
      continue;
    }
    const switchFixture = fixtureById.get(switchId);
    const lampFixture = fixtureById.get(lampId);
    if (switchFixture?.kind !== "switch" || lampFixture?.kind !== "lamp") {
      continue;
    }
    const fromSwitchInRoom = switchIds.has(switchId);
    const toLampInRoom = lampIds.has(lampId);
    if (fromSwitchInRoom || toLampInRoom) {
      linksInRoom.push({
        ...link,
        switchId,
        targetType: "lamp",
        targetId: lampId
      });
    }
  }

  return {
    lighting,
    fixtureById,
    fixtureIdsInRoom,
    switchIdsInRoom: switchIds,
    lampIdsInRoom: lampIds,
    linksInRoom
  };
}

function deriveRoomElectricityInventory(roomEntry, plan) {
  const membership = deriveRoomLightingMembership(roomEntry, plan);
  const controlledLampIds = new Set();

  for (const link of membership.linksInRoom) {
    if (link?.targetType === "lamp" && membership.lampIdsInRoom.has(link?.targetId)) {
      controlledLampIds.add(link.targetId);
    }
  }

  const groups = deriveLightingGroupsFromLinks(
    membership.linksInRoom,
    membership.fixtureById,
    membership.lampIdsInRoom
  );

  const controlledLampIdList = Array.from(controlledLampIds);
  const orphanLampIds = Array.from(membership.lampIdsInRoom).filter((lampId) => !controlledLampIds.has(lampId));
  const switchIdsWithNoLinks = Array.from(membership.switchIdsInRoom).filter((switchId) => (
    !membership.linksInRoom.some((link) => link?.switchId === switchId && link?.targetType === "lamp")
  ));

  return {
    switches: Array.from(membership.switchIdsInRoom),
    lamps: Array.from(membership.lampIdsInRoom),
    controlledLampIds: controlledLampIdList,
    groups,
    links: membership.linksInRoom,
    switchIdsWithNoLinks,
    orphanLampIds,
    sockets: []
  };
}

function getLightingCollections(plan) {
  const rawLighting = plan?.entities?.lighting;
  const fixtures = Array.isArray(rawLighting?.fixtures) ? rawLighting.fixtures : [];
  const links = Array.isArray(rawLighting?.links) ? rawLighting.links : [];
  return { fixtures, links };
}

function formatLightingOverlaySummary(plan, editorState) {
  const totals = computeLightingTotals(plan);
  const selectedFixture = getSelectedLightingFixture(plan, editorState);
  const linkSwitchId = normalizeRectangleIdForUi(editorState?.lightingSelection?.linkSwitchId);
  const linkSourceLabel = linkSwitchId ? `source ${linkSwitchId}` : "source none";
  const selectedLabel = selectedFixture ? `${selectedFixture.kind} ${selectedFixture.id}` : "none";
  return `switches ${totals.switchCount}, lamps ${totals.lampCount}, groups ${totals.groupCount}, links ${totals.linkCount}; subtypes ${formatLightingSubtypeCounts(totals.subtypeCounts) || "none"}; selected ${selectedLabel}; ${linkSourceLabel}`;
}

function formatOpeningOverlaySummary(plan, editorState) {
  const openings = Array.isArray(plan?.entities?.openings) ? plan.entities.openings : [];
  const selected = getSelectedOpening(plan, editorState);
  const doorCount = openings.filter((opening) => opening?.kind === "door").length;
  const windowCount = openings.filter((opening) => opening?.kind === "window").length;
  const selectedLabel = selected ? `${selected.kind} ${selected.id}` : "none";
  return `doors ${doorCount}, windows ${windowCount}, total ${openings.length}; selected ${selectedLabel}`;
}

function formatLightingSubtypeCounts(subtypeCounts) {
  const entries = Object.entries(subtypeCounts ?? {})
    .filter(([, count]) => Number.isFinite(count) && count > 0)
    .sort((left, right) => left[0].localeCompare(right[0]));
  if (entries.length === 0) {
    return "";
  }
  return entries.map(([subtype, count]) => `${subtype}:${count}`).join(", ");
}

function createDefaultQuoteModelForRuntime() {
  return {
    groupMode: DEFAULT_QUOTE_MODEL.groupMode,
    catalog: {
      baseboardProfiles: DEFAULT_QUOTE_MODEL.catalog.baseboardProfiles.map((item) => ({ ...item })),
      flooringTypes: DEFAULT_QUOTE_MODEL.catalog.flooringTypes.map((item) => ({ ...item })),
      paintingTypes: DEFAULT_QUOTE_MODEL.catalog.paintingTypes.map((item) => ({ ...item })),
      switchProducts: DEFAULT_QUOTE_MODEL.catalog.switchProducts.map((item) => ({ ...item })),
      lampProducts: DEFAULT_QUOTE_MODEL.catalog.lampProducts.map((item) => ({ ...item })),
      doorProducts: DEFAULT_QUOTE_MODEL.catalog.doorProducts.map((item) => ({ ...item }))
    },
    defaults: { ...DEFAULT_QUOTE_MODEL.defaults },
    roomConfigs: {}
  };
}

function getQuoteModel(plan) {
  const defaults = createDefaultQuoteModelForRuntime();
  const rawQuote = isPlainObjectValue(plan?.quote) ? plan.quote : {};
  const rawCatalog = isPlainObjectValue(rawQuote.catalog) ? rawQuote.catalog : {};
  const rawDefaults = isPlainObjectValue(rawQuote.defaults) ? rawQuote.defaults : {};
  const rawRoomConfigs = isPlainObjectValue(rawQuote.roomConfigs) ? rawQuote.roomConfigs : {};
  const quote = {
    groupMode: rawQuote.groupMode === "job" ? "job" : "room",
    catalog: {
      baseboardProfiles: normalizeQuoteCatalogListRuntime(rawCatalog.baseboardProfiles, defaults.catalog.baseboardProfiles, "baseboard"),
      flooringTypes: normalizeQuoteCatalogListRuntime(rawCatalog.flooringTypes, defaults.catalog.flooringTypes, "area"),
      paintingTypes: normalizeQuoteCatalogListRuntime(rawCatalog.paintingTypes, defaults.catalog.paintingTypes, "area"),
      switchProducts: normalizeQuoteCatalogListRuntime(rawCatalog.switchProducts, defaults.catalog.switchProducts, "unit"),
      lampProducts: normalizeQuoteCatalogListRuntime(rawCatalog.lampProducts, defaults.catalog.lampProducts, "unit"),
      doorProducts: normalizeQuoteCatalogListRuntime(rawCatalog.doorProducts, defaults.catalog.doorProducts, "unit")
    },
    defaults: {
      baseboardProfileId: normalizeRectangleIdForUi(rawDefaults.baseboardProfileId) ?? defaults.defaults.baseboardProfileId,
      flooringTypeId: normalizeRectangleIdForUi(rawDefaults.flooringTypeId) ?? defaults.defaults.flooringTypeId,
      paintingTypeId: normalizeRectangleIdForUi(rawDefaults.paintingTypeId) ?? defaults.defaults.paintingTypeId,
      switchProductId: normalizeRectangleIdForUi(rawDefaults.switchProductId) ?? defaults.defaults.switchProductId,
      lampProductId: normalizeRectangleIdForUi(rawDefaults.lampProductId) ?? defaults.defaults.lampProductId,
      doorProductId: normalizeRectangleIdForUi(rawDefaults.doorProductId) ?? defaults.defaults.doorProductId
    },
    roomConfigs: {}
  };

  for (const [roomEntryId, rawConfig] of Object.entries(rawRoomConfigs)) {
    const normalizedRoomEntryId = normalizeRectangleIdForUi(roomEntryId);
    if (!normalizedRoomEntryId || !isPlainObjectValue(rawConfig)) {
      continue;
    }
    quote.roomConfigs[normalizedRoomEntryId] = {
      includeBaseboard: rawConfig.includeBaseboard !== false,
      flooringTypeId: normalizeRectangleIdForUi(rawConfig.flooringTypeId) ?? quote.defaults.flooringTypeId,
      paintingTypeId: normalizeRectangleIdForUi(rawConfig.paintingTypeId) ?? quote.defaults.paintingTypeId,
      baseboardProfileId: normalizeRectangleIdForUi(rawConfig.baseboardProfileId) ?? quote.defaults.baseboardProfileId
    };
  }
  return quote;
}

function normalizeQuoteCatalogListRuntime(rawList, fallbackList, mode) {
  const source = Array.isArray(rawList) ? rawList : fallbackList;
  const normalized = [];
  for (const item of source) {
    if (!isPlainObjectValue(item)) {
      continue;
    }
    const id = normalizeRectangleIdForUi(item.id);
    const name = normalizeRectangleIdForUi(item.name) ?? (typeof item.name === "string" ? item.name.trim() : null);
    if (!id || !name || normalized.some((candidate) => candidate.id === id)) {
      continue;
    }
    if (mode === "baseboard") {
      normalized.push({
        id,
        name,
        materialPerM: Number.isFinite(item.materialPerM) ? Math.max(0, item.materialPerM) : 0,
        laborPerM: Number.isFinite(item.laborPerM) ? Math.max(0, item.laborPerM) : 0
      });
      continue;
    }
    if (mode === "area") {
      normalized.push({
        id,
        name,
        materialPerM2: Number.isFinite(item.materialPerM2) ? Math.max(0, item.materialPerM2) : 0,
        laborPerM2: Number.isFinite(item.laborPerM2) ? Math.max(0, item.laborPerM2) : 0
      });
      continue;
    }
    normalized.push({
      id,
      name,
      unitPrice: Number.isFinite(item.unitPrice) ? Math.max(0, item.unitPrice) : 0
    });
  }
  if (normalized.length > 0) {
    return normalized;
  }
  return Array.isArray(fallbackList) ? fallbackList.map((item) => ({ ...item })) : [];
}

function resolveQuoteCatalogItemById(list, requestedId, fallbackId = null) {
  const items = Array.isArray(list) ? list : [];
  const requested = normalizeRectangleIdForUi(requestedId);
  if (requested) {
    const item = items.find((candidate) => candidate.id === requested);
    if (item) {
      return item;
    }
  }
  const fallback = normalizeRectangleIdForUi(fallbackId);
  if (fallback) {
    const item = items.find((candidate) => candidate.id === fallback);
    if (item) {
      return item;
    }
  }
  return items[0] ?? null;
}

function getRoomQuoteConfig(quote, roomEntryId) {
  const normalizedRoomEntryId = normalizeRectangleIdForUi(roomEntryId);
  const rawConfig = normalizedRoomEntryId ? quote?.roomConfigs?.[normalizedRoomEntryId] : null;
  return {
    includeBaseboard: rawConfig?.includeBaseboard !== false,
    flooringTypeId: normalizeRectangleIdForUi(rawConfig?.flooringTypeId) ?? quote?.defaults?.flooringTypeId,
    paintingTypeId: normalizeRectangleIdForUi(rawConfig?.paintingTypeId) ?? quote?.defaults?.paintingTypeId,
    baseboardProfileId: normalizeRectangleIdForUi(rawConfig?.baseboardProfileId) ?? quote?.defaults?.baseboardProfileId
  };
}

function generateQuoteCatalogId(prefix, name, existingItems) {
  const slug = String(name)
    .trim()
    .toLowerCase()
    .replaceAll(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .replaceAll(/_+/g, "_");
  const baseId = `${prefix}_${slug || "custom"}`;
  const existingIds = new Set(
    Array.isArray(existingItems) ? existingItems.map((item) => item?.id).filter(Boolean) : []
  );
  if (!existingIds.has(baseId)) {
    return baseId;
  }
  let suffix = 2;
  while (existingIds.has(`${baseId}_${suffix}`)) {
    suffix += 1;
  }
  return `${baseId}_${suffix}`;
}

function buildPlanExportPayload(plan, options = {}) {
  const derivedLighting = deriveLightingSnapshot(plan);
  const derivedBaseboards = deriveBaseboardExportSnapshot(
    options.baseboard ?? deriveBaseboardCandidates(plan, {
      excludedRoomTypes: BASEBOARD_EXCLUDED_ROOM_TYPES
    })
  );
  const derived = isPlainObjectValue(plan?.derived)
    ? { ...plan.derived }
    : {};
  derived.lighting = derivedLighting;
  derived.baseboards = derivedBaseboards;
  return {
    ...plan,
    derived
  };
}

function deriveLightingSnapshot(plan) {
  const lighting = getLightingCollections(plan);
  const totals = computeLightingTotals(plan);
  const roomTotals = deriveLightingRoomTotals(plan, lighting);
  const validation = deriveLightingValidationFindings(plan);
  return {
    fixtureCountsBySubtype: totals.subtypeCounts,
    switchCount: totals.switchCount,
    lampCount: totals.lampCount,
    groupCount: totals.groupCount,
    linkCount: totals.linkCount,
    roomTotals,
    warningCount: validation.filter((finding) => finding.severity === "warning").length,
    findings: validation.map((finding) => ({
      code: finding.code,
      severity: finding.severity,
      message: finding.message,
      count: finding.count
    }))
  };
}

function deriveLightingRoomTotals(plan, lighting = null) {
  const collections = lighting ?? getLightingCollections(plan);
  const rooms = Array.isArray(plan?.entities?.rooms) ? plan.entities.rooms : [];
  const roomById = new Map(
    rooms
      .filter((room) => typeof room?.id === "string" && room.id)
      .map((room) => [room.id, room])
  );
  const roomIds = new Set(
    collections.fixtures
      .map((fixture) => normalizeRectangleIdForUi(fixture?.roomId))
      .filter(Boolean)
  );
  const totals = [];
  const fixtureById = new Map(
    collections.fixtures
      .filter((fixture) => typeof fixture?.id === "string" && fixture.id)
      .map((fixture) => [fixture.id, fixture])
  );
  const validLinks = collectValidLampLinks(collections.links, fixtureById);
  for (const roomId of roomIds) {
    let switchCount = 0;
    let lampCount = 0;
    const subtypeCounts = {};
    for (const fixture of collections.fixtures) {
      if (fixture?.roomId !== roomId) {
        continue;
      }
      if (fixture.kind === "switch") {
        switchCount += 1;
      } else if (fixture.kind === "lamp") {
        lampCount += 1;
      }
      const subtype = typeof fixture?.subtype === "string" && fixture.subtype
        ? fixture.subtype
        : (fixture?.kind === "switch" ? "switch_single" : "lamp");
      subtypeCounts[subtype] = (subtypeCounts[subtype] ?? 0) + 1;
    }
    const switchIds = new Set(
      collections.fixtures
        .filter((fixture) => fixture?.kind === "switch" && fixture?.roomId === roomId && typeof fixture?.id === "string")
        .map((fixture) => fixture.id)
    );
    const roomLinks = validLinks.filter((link) => switchIds.has(link?.switchId));
    const groupCount = deriveLightingGroupsFromLinks(roomLinks, fixtureById).length;
    const linkCount = roomLinks.length;
    totals.push({
      roomId,
      roomName: roomById.get(roomId)?.name ?? roomId,
      switchCount,
      lampCount,
      groupCount,
      linkCount,
      fixtureCountsBySubtype: subtypeCounts
    });
  }
  totals.sort((left, right) => left.roomName.localeCompare(right.roomName, undefined, { sensitivity: "base" }));
  return totals;
}

function deriveLightingValidationFindings(plan) {
  const lighting = getLightingCollections(plan);
  if (lighting.fixtures.length === 0 && lighting.links.length === 0) {
    return [];
  }

  const fixtureById = new Map(
    lighting.fixtures
      .filter((fixture) => typeof fixture?.id === "string" && fixture.id)
      .map((fixture) => [fixture.id, fixture])
  );
  const rectangleById = new Map(
    (Array.isArray(plan?.entities?.rectangles) ? plan.entities.rectangles : [])
      .filter((rectangle) => typeof rectangle?.id === "string" && rectangle.id)
      .map((rectangle) => [rectangle.id, rectangle])
  );

  const findings = [];
  const danglingLinksCount = countDanglingLightingLinks(lighting.links, fixtureById);
  if (danglingLinksCount > 0) {
    findings.push({
      code: "lighting_link_dangling_target",
      severity: "warning",
      message: `${danglingLinksCount} invalid switch link${danglingLinksCount === 1 ? "" : "s"}`,
      count: danglingLinksCount
    });
  }

  const invalidSwitchHostCount = countInvalidSwitchHosts(lighting.fixtures, rectangleById);
  if (invalidSwitchHostCount > 0) {
    findings.push({
      code: "lighting_switch_host_invalid",
      severity: "warning",
      message: `${invalidSwitchHostCount} switch fixture${invalidSwitchHostCount === 1 ? "" : "s"} with invalid wall host`,
      count: invalidSwitchHostCount
    });
  }

  const driftedSwitchCount = countSwitchHostDrift(lighting.fixtures, rectangleById);
  if (driftedSwitchCount > 0) {
    findings.push({
      code: "lighting_switch_host_drift",
      severity: "warning",
      message: `${driftedSwitchCount} switch fixture${driftedSwitchCount === 1 ? "" : "s"} drifted from host wall`,
      count: driftedSwitchCount
    });
  }

  return findings;
}

function deriveOpeningValidationFindings(plan) {
  const openings = Array.isArray(plan?.entities?.openings) ? plan.entities.openings : [];
  if (openings.length === 0) {
    return [];
  }
  const rectangleById = new Map(
    (Array.isArray(plan?.entities?.rectangles) ? plan.entities.rectangles : [])
      .filter((rectangle) => typeof rectangle?.id === "string" && rectangle.id)
      .map((rectangle) => [rectangle.id, rectangle])
  );

  const findings = [];
  const invalidHostCount = countInvalidOpeningHosts(openings, rectangleById);
  if (invalidHostCount > 0) {
    findings.push({
      code: "opening_host_invalid",
      severity: "warning",
      message: `${invalidHostCount} opening${invalidHostCount === 1 ? "" : "s"} with invalid wall host`,
      count: invalidHostCount
    });
  }

  const driftedCount = countDriftedOpenings(openings, plan, 1);
  if (driftedCount > 0) {
    findings.push({
      code: "opening_host_drift",
      severity: "warning",
      message: `${driftedCount} opening${driftedCount === 1 ? "" : "s"} drifted from host wall`,
      count: driftedCount
    });
  }

  return findings;
}

function deriveClosureValidationFindings(baseboard, metersPerWorldUnit = null) {
  const unsupportedSegments = Array.isArray(baseboard?.unsupportedOpenSides)
    ? baseboard.unsupportedOpenSides
    : [];
  if (unsupportedSegments.length === 0) {
    return [];
  }
  const totalLengthWorld = unsupportedSegments.reduce(
    (sum, segment) => sum + (Number.isFinite(segment?.lengthWorld) ? segment.lengthWorld : 0),
    0
  );
  const totalLengthMeters = Number.isFinite(metersPerWorldUnit) && metersPerWorldUnit > 0
    ? totalLengthWorld * metersPerWorldUnit
    : null;
  const lengthLabel = Number.isFinite(totalLengthMeters)
    ? `${totalLengthMeters.toFixed(2)}m`
    : `${totalLengthWorld.toFixed(1)}wu`;

  return [
    {
      code: "closure_gap_detected",
      severity: "warning",
      message: `${unsupportedSegments.length} closure gap segment${unsupportedSegments.length === 1 ? "" : "s"} totaling ${lengthLabel}`,
      count: unsupportedSegments.length
    }
  ];
}

function countInvalidOpeningHosts(openings, rectangleById) {
  if (!Array.isArray(openings) || !(rectangleById instanceof Map)) {
    return 0;
  }
  let count = 0;
  for (const opening of openings) {
    const host = opening?.host;
    const rectangleId = normalizeRectangleIdForUi(host?.rectangleId);
    const side = normalizeWallSideForUi(host?.side);
    const offset = host?.offset;
    const rectangle = rectangleId ? rectangleById.get(rectangleId) : null;
    if (
      host?.type !== "wallSide" ||
      !rectangle ||
      !side ||
      !Number.isFinite(offset) ||
      !isRectangleSideWallCapable(rectangle, side)
    ) {
      count += 1;
    }
  }
  return count;
}

function countDriftedOpenings(openings, plan, tolerance = 1) {
  if (!Array.isArray(openings)) {
    return 0;
  }
  let count = 0;
  for (const opening of openings) {
    if (!Number.isFinite(opening?.x) || !Number.isFinite(opening?.y)) {
      continue;
    }
    const geometry = deriveOpeningGeometry(plan, opening);
    if (!geometry) {
      continue;
    }
    const distance = Math.hypot(geometry.centerX - opening.x, geometry.centerY - opening.y);
    if (distance > tolerance) {
      count += 1;
    }
  }
  return count;
}

function countDanglingLightingLinks(links, fixtureById) {
  if (!Array.isArray(links) || !(fixtureById instanceof Map)) {
    return 0;
  }
  let count = 0;
  for (const link of links) {
    const switchFixture = fixtureById.get(link?.switchId);
    if (!switchFixture || switchFixture.kind !== "switch") {
      count += 1;
      continue;
    }
    if (link?.targetType !== "lamp") {
      count += 1;
      continue;
    }
    const targetLamp = fixtureById.get(link?.targetId);
    if (!targetLamp || targetLamp.kind !== "lamp") {
      count += 1;
    }
  }
  return count;
}

function countInvalidSwitchHosts(fixtures, rectangleById) {
  if (!Array.isArray(fixtures) || !(rectangleById instanceof Map)) {
    return 0;
  }
  let count = 0;
  for (const fixture of fixtures) {
    if (fixture?.kind !== "switch") {
      continue;
    }
    const host = fixture.host;
    const rectangleId = normalizeRectangleIdForUi(host?.rectangleId);
    const side = host?.side;
    const offset = host?.offset;
    if (
      host?.type !== "wallSide" ||
      !rectangleId ||
      !rectangleById.has(rectangleId) ||
      (side !== "top" && side !== "right" && side !== "bottom" && side !== "left") ||
      !Number.isFinite(offset)
    ) {
      count += 1;
    }
  }
  return count;
}

function countSwitchHostDrift(fixtures, rectangleById, tolerance = 1) {
  if (!Array.isArray(fixtures) || !(rectangleById instanceof Map)) {
    return 0;
  }
  let count = 0;
  for (const fixture of fixtures) {
    if (fixture?.kind !== "switch" || fixture?.host?.type !== "wallSide") {
      continue;
    }
    const rectangleId = normalizeRectangleIdForUi(fixture.host.rectangleId);
    const rectangle = rectangleId ? rectangleById.get(rectangleId) : null;
    if (!rectangle) {
      continue;
    }
    const projected = projectSwitchFixtureToHostPosition(rectangle, fixture.host.side, fixture.host.offset);
    if (!projected) {
      continue;
    }
    const distance = Math.hypot(projected.x - fixture.x, projected.y - fixture.y);
    if (distance > tolerance) {
      count += 1;
    }
  }
  return count;
}

function isPlainObjectValue(value) {
  return value != null && typeof value === "object" && !Array.isArray(value);
}

function formatSelectedRectangleWallCmStatus(rectangle) {
  if (!rectangle) {
    return "";
  }
  if (rectangle.kind === "wallRect") {
    return "";
  }
  const wallCm = normalizeWallCmForUi(rectangle.wallCm);
  return `T${wallCm.top} R${wallCm.right} B${wallCm.bottom} L${wallCm.left}cm`;
}

function formatSelectedRectangleWallCmOverlay(rectangle) {
  if (!rectangle) {
    return "none";
  }
  if (rectangle.kind === "wallRect") {
    return "n/a for wallRect";
  }
  const wallCm = normalizeWallCmForUi(rectangle.wallCm);
  return `top ${wallCm.top}cm, right ${wallCm.right}cm, bottom ${wallCm.bottom}cm, left ${wallCm.left}cm`;
}

function formatBaseboardSummaryDebug(baseboard, showOverlay) {
  const visibility = showOverlay ? "on" : "off";
  if (!baseboard) {
    return `0/0 segments counted/raw (${visibility})`;
  }
  const countedSegmentCount = Number.isFinite(baseboard.segmentCount) ? baseboard.segmentCount : 0;
  const rawSegmentCount = Number.isFinite(baseboard.rawSegmentCount) ? baseboard.rawSegmentCount : countedSegmentCount;
  const excludedLengthWorld = Number.isFinite(baseboard.excludedLengthWorld) ? baseboard.excludedLengthWorld : 0;
  const excludedLabel = excludedLengthWorld > 0
    ? `, excl ${formatBaseboardExcludedLength(baseboard)}`
    : "";
  return `${countedSegmentCount}/${rawSegmentCount} segments, ${formatBaseboardLength(baseboard)}${excludedLabel} (${visibility})`;
}

function formatBaseboardSummaryStatus(baseboard, showOverlay) {
  const visibility = showOverlay ? "bb:on" : "bb:off";
  if (!baseboard) {
    return `${visibility} seg:0/0`;
  }
  const countedSegmentCount = Number.isFinite(baseboard.segmentCount) ? baseboard.segmentCount : 0;
  const rawSegmentCount = Number.isFinite(baseboard.rawSegmentCount) ? baseboard.rawSegmentCount : countedSegmentCount;
  const excludedLengthWorld = Number.isFinite(baseboard.excludedLengthWorld) ? baseboard.excludedLengthWorld : 0;
  const excludedLabel = excludedLengthWorld > 0
    ? ` excl:${formatBaseboardExcludedLength(baseboard)}`
    : "";
  return `${visibility} seg:${countedSegmentCount}/${rawSegmentCount} len:${formatBaseboardLength(baseboard)}${excludedLabel}`;
}

function formatBaseboardSummaryOverlay(baseboard, showOverlay) {
  const visibility = showOverlay ? "visible" : "hidden";
  if (!baseboard) {
    return `counted 0 seg (0.0wu), raw 0 seg (0.0wu), excluded 0.0wu (${visibility})`;
  }
  const countedSegmentCount = Number.isFinite(baseboard.segmentCount) ? baseboard.segmentCount : 0;
  const rawSegmentCount = Number.isFinite(baseboard.rawSegmentCount) ? baseboard.rawSegmentCount : countedSegmentCount;
  return `counted ${countedSegmentCount} seg (${formatBaseboardLength(baseboard)}), raw ${rawSegmentCount} seg (${formatBaseboardRawLength(baseboard)}), excluded ${formatBaseboardExcludedLength(baseboard)} (${visibility})`;
}

function formatBaseboardLength(baseboard) {
  return formatLengthMetersOrWorld(baseboard, "totalLengthMeters", "totalLengthWorld");
}

function formatBaseboardRawLength(baseboard) {
  return formatLengthMetersOrWorld(baseboard, "rawTotalLengthMeters", "rawTotalLengthWorld");
}

function formatBaseboardExcludedLength(baseboard) {
  return formatLengthMetersOrWorld(baseboard, "excludedLengthMeters", "excludedLengthWorld");
}

function formatLengthMetersOrWorld(valueSource, metersKey, worldKey) {
  if (!valueSource) {
    return "0.0wu";
  }
  if (Number.isFinite(valueSource[metersKey])) {
    return `${valueSource[metersKey].toFixed(2)}m`;
  }
  if (Number.isFinite(valueSource[worldKey])) {
    return `${valueSource[worldKey].toFixed(1)}wu`;
  }
  return "n/a";
}

function formatBaseboardConflictSummaryStatus(conflicts, showOverlay) {
  const visibility = showOverlay ? "bb-conf:on" : "bb-conf:off";
  if (!conflicts) {
    return `${visibility} c:0`;
  }
  return `${visibility} c:${conflicts.conflictCount} len:${formatConflictLength(conflicts)}`;
}

function formatBaseboardConflictSummaryOverlay(conflicts, showOverlay) {
  const visibility = showOverlay ? "visible" : "hidden";
  if (!conflicts) {
    return `0 intervals (${visibility})`;
  }
  return `${conflicts.conflictCount} interval${conflicts.conflictCount === 1 ? "" : "s"}, total ${formatConflictLength(conflicts)} (${visibility})`;
}

function formatConflictLength(conflicts) {
  if (!conflicts) {
    return "0.0wu";
  }
  if (Number.isFinite(conflicts.totalLengthMeters)) {
    return `${conflicts.totalLengthMeters.toFixed(2)}m`;
  }
  if (Number.isFinite(conflicts.totalLengthWorld)) {
    return `${conflicts.totalLengthWorld.toFixed(1)}wu`;
  }
  return "n/a";
}

function deriveBaseboardConflictOverlay(baseboard, metersPerWorldUnit = null, overlapToleranceWorld = 0.5) {
  const countedSegments = Array.isArray(baseboard?.segments) ? baseboard.segments : [];
  if (countedSegments.length < 2) {
    return {
      segments: [],
      conflictCount: 0,
      pairCount: 0,
      totalLengthWorld: 0,
      totalLengthMeters: Number.isFinite(metersPerWorldUnit) ? 0 : null
    };
  }

  const tolerance = Number.isFinite(overlapToleranceWorld) && overlapToleranceWorld > 0
    ? overlapToleranceWorld
    : 0.5;
  const intervalsByLine = new Map();
  let pairCount = 0;

  for (let index = 0; index < countedSegments.length; index += 1) {
    const left = deriveAxisAlignedSegmentDescriptor(countedSegments[index]);
    if (!left) {
      continue;
    }
    for (let otherIndex = index + 1; otherIndex < countedSegments.length; otherIndex += 1) {
      const right = deriveAxisAlignedSegmentDescriptor(countedSegments[otherIndex]);
      if (!right || right.axis !== left.axis) {
        continue;
      }
      if (Math.abs(right.coordinate - left.coordinate) > tolerance) {
        continue;
      }
      const overlapStart = Math.max(left.start, right.start);
      const overlapEnd = Math.min(left.end, right.end);
      if (!(overlapEnd - overlapStart > tolerance)) {
        continue;
      }
      pairCount += 1;
      const lineCoordinate = (left.coordinate + right.coordinate) / 2;
      const lineKey = `${left.axis}:${lineCoordinate.toFixed(3)}`;
      if (!intervalsByLine.has(lineKey)) {
        intervalsByLine.set(lineKey, {
          axis: left.axis,
          coordinate: lineCoordinate,
          intervals: []
        });
      }
      intervalsByLine.get(lineKey).intervals.push({
        start: overlapStart,
        end: overlapEnd
      });
    }
  }

  const segments = [];
  for (const [lineKey, entry] of intervalsByLine.entries()) {
    const merged = mergeSimpleIntervals(entry.intervals);
    for (let intervalIndex = 0; intervalIndex < merged.length; intervalIndex += 1) {
      const interval = merged[intervalIndex];
      const lengthWorld = Math.max(0, interval.end - interval.start);
      if (lengthWorld <= 0) {
        continue;
      }
      const segmentId = `${lineKey}:${intervalIndex + 1}`;
      if (entry.axis === "horizontal") {
        segments.push({
          id: segmentId,
          axis: "horizontal",
          coordinate: entry.coordinate,
          start: interval.start,
          end: interval.end,
          lengthWorld,
          lengthMeters: Number.isFinite(metersPerWorldUnit) ? lengthWorld * metersPerWorldUnit : null,
          x0: interval.start,
          y0: entry.coordinate,
          x1: interval.end,
          y1: entry.coordinate
        });
      } else {
        segments.push({
          id: segmentId,
          axis: "vertical",
          coordinate: entry.coordinate,
          start: interval.start,
          end: interval.end,
          lengthWorld,
          lengthMeters: Number.isFinite(metersPerWorldUnit) ? lengthWorld * metersPerWorldUnit : null,
          x0: entry.coordinate,
          y0: interval.start,
          x1: entry.coordinate,
          y1: interval.end
        });
      }
    }
  }

  const totalLengthWorld = segments.reduce((sum, segment) => sum + (segment.lengthWorld ?? 0), 0);
  return {
    segments,
    conflictCount: segments.length,
    pairCount,
    totalLengthWorld,
    totalLengthMeters: Number.isFinite(metersPerWorldUnit) ? totalLengthWorld * metersPerWorldUnit : null
  };
}

function deriveAxisAlignedSegmentDescriptor(segment) {
  const x0 = Number.isFinite(segment?.x0) ? segment.x0 : null;
  const y0 = Number.isFinite(segment?.y0) ? segment.y0 : null;
  const x1 = Number.isFinite(segment?.x1) ? segment.x1 : null;
  const y1 = Number.isFinite(segment?.y1) ? segment.y1 : null;
  if (x0 == null || y0 == null || x1 == null || y1 == null) {
    return null;
  }
  if (Math.abs(y1 - y0) <= 1e-6) {
    return {
      axis: "horizontal",
      coordinate: (y0 + y1) / 2,
      start: Math.min(x0, x1),
      end: Math.max(x0, x1)
    };
  }
  if (Math.abs(x1 - x0) <= 1e-6) {
    return {
      axis: "vertical",
      coordinate: (x0 + x1) / 2,
      start: Math.min(y0, y1),
      end: Math.max(y0, y1)
    };
  }
  return null;
}

function formatValidationSummaryDebug(validation) {
  if (!validation || validation.status === "ok") {
    return "OK";
  }
  return `WARN (${validation.warningCount})`;
}

function formatValidationSummaryStatus(validation) {
  if (!validation || validation.status === "ok") {
    return "validation ok";
  }
  return `validation warn:${validation.warningCount}`;
}

function formatClosureValidationStatus(validation) {
  const closureFinding = findClosureValidationFinding(validation);
  if (!closureFinding) {
    return "closure ok";
  }
  return `closure warn:${closureFinding.count ?? 1}`;
}

function formatClosureValidationOverlay(validation) {
  const closureFinding = findClosureValidationFinding(validation);
  if (!closureFinding) {
    return "No closure gaps detected";
  }
  return closureFinding.message;
}

function findClosureValidationFinding(validation) {
  const findings = Array.isArray(validation?.findings) ? validation.findings : [];
  return findings.find((finding) => finding?.code === "closure_gap_detected") ?? null;
}

function formatValidationPrimaryMessage(validation) {
  const finding = validation?.findings?.[0];
  if (!finding) {
    return "No basic geometry warnings";
  }
  return `First warning: ${finding.message}`;
}

function formatValidationDetail(validation) {
  if (!validation) {
    return "validation unavailable";
  }

  if (validation.warningCount === 0) {
    return `OK (basic checks passed across ${validation.rectangleCount} rectangle${validation.rectangleCount === 1 ? "" : "s"})`;
  }

  const messages = validation.findings
    .filter((finding) => finding.severity === "warning")
    .map((finding) => finding.message);
  return `WARN ${validation.warningCount}: ${messages.join("; ")}`;
}

function formatValidationOverlapFlashDebug(validation, timestamp) {
  const flashState = getActiveOverlapFlashState(validation, timestamp);
  if (!flashState) {
    return "none";
  }
  const pairLabel = formatOverlapPairLabel(flashState.pair);
  return `${flashState.pairIndex + 1}/${flashState.totalPairs} ${pairLabel} ${flashState.flashOn ? "ON" : "off"}`;
}

function formatValidationOverlapFlashStatus(validation, timestamp) {
  const flashState = getActiveOverlapFlashState(validation, timestamp);
  if (!flashState) {
    return "none";
  }
  return `flash:${flashState.pairIndex + 1}/${flashState.totalPairs}`;
}

function formatValidationOverlapFlashOverlay(validation, timestamp) {
  const flashState = getActiveOverlapFlashState(validation, timestamp);
  if (!flashState) {
    return "none";
  }
  return `pair ${flashState.pairIndex + 1}/${flashState.totalPairs} ${formatOverlapPairLabel(flashState.pair)} (${flashState.flashOn ? "on" : "off"})`;
}

function getActiveOverlapFlashState(validation, timestamp) {
  const overlapPairs = Array.isArray(validation?.overlapPairs) ? validation.overlapPairs : [];
  if (overlapPairs.length === 0) {
    return null;
  }

  const ms = Number.isFinite(timestamp) ? timestamp : performance.now();
  const pairIndex = Math.floor(ms / OVERLAP_FLASH_PAIR_DURATION_MS) % overlapPairs.length;
  const flashOn = Math.floor(ms / OVERLAP_FLASH_BLINK_PERIOD_MS) % 2 === 0;
  return {
    pair: overlapPairs[pairIndex],
    pairIndex,
    totalPairs: overlapPairs.length,
    flashOn
  };
}

function formatOverlapPairLabel(pair) {
  if (!pair) {
    return "? ↔ ?";
  }
  const aLabel = pair.aId || toOverlapIndexLabel(pair.aIndex);
  const bLabel = pair.bId || toOverlapIndexLabel(pair.bIndex);
  return `${aLabel} ↔ ${bLabel}`;
}

function toOverlapIndexLabel(index) {
  return Number.isInteger(index) ? `rect_${index + 1}` : "rect";
}

function resolveOverlapPairRectangle(rectangles, pairIndex, pairId) {
  if (!Array.isArray(rectangles) || rectangles.length === 0) {
    return null;
  }
  if (Number.isInteger(pairIndex) && pairIndex >= 0 && pairIndex < rectangles.length) {
    const byIndex = rectangles[pairIndex];
    if (byIndex && (!pairId || byIndex.id === pairId)) {
      return byIndex;
    }
  }
  if (typeof pairId === "string" && pairId) {
    return rectangles.find((rectangle) => rectangle?.id === pairId) ?? null;
  }
  return null;
}

function collectUniqueOverlapRectangles(rectangles, overlapPairs) {
  const unique = [];
  const seen = new Set();

  for (const pair of overlapPairs) {
    const a = resolveOverlapPairRectangle(rectangles, pair?.aIndex, pair?.aId);
    if (a && !seen.has(a)) {
      seen.add(a);
      unique.push(a);
    }

    const b = resolveOverlapPairRectangle(rectangles, pair?.bIndex, pair?.bId);
    if (b && !seen.has(b)) {
      seen.add(b);
      unique.push(b);
    }
  }

  return unique;
}

function formatFileTransferStatusShort(status) {
  const phase = status?.phase ?? "idle";
  switch (phase) {
    case "importing":
      return "importing";
    case "imported":
      return "imported";
    case "exported":
      return "exported";
    case "error":
      return "error";
    default:
      return "idle";
  }
}

function formatFileTransferStatusDetail(status) {
  if (!status || status.phase === "idle") {
    return "idle (use Export JSON / Import JSON in toolbar)";
  }

  const prefix = status.phase === "error" ? "ERROR" : status.phase.toUpperCase();
  if (!status.message) {
    return prefix;
  }
  return `${prefix}: ${escapeHtmlForOverlay(status.message)}`;
}

function buildPlanExportFileName(plan) {
  const baseName = sanitizeFileName(plan?.meta?.name || "apartment-plan");
  const timestamp = new Date().toISOString().replaceAll(":", "-");
  return `${baseName}_${timestamp}.json`;
}

function sanitizeFileName(value) {
  return String(value)
    .trim()
    .replaceAll(/[^a-zA-Z0-9_-]+/g, "-")
    .replaceAll(/-+/g, "-")
    .replace(/^-|-$/g, "") || "apartment-plan";
}

function escapeHtmlForOverlay(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");
}

function normalizeWallCmForUi(rawWallCm) {
  const wallCm = normalizeWallCm(rawWallCm);
  return {
    top: normalizeWallSideValue(wallCm.top),
    right: normalizeWallSideValue(wallCm.right),
    bottom: normalizeWallSideValue(wallCm.bottom),
    left: normalizeWallSideValue(wallCm.left)
  };
}

function formatRoomTypeLabel(roomType) {
  switch (roomType) {
    case "living_room":
      return "living room";
    case "bedroom":
      return "bedroom";
    case "kitchen":
      return "kitchen";
    case "bathroom":
      return "bathroom";
    case "toilet":
      return "toilet";
    case "hallway":
      return "hallway";
    case "closet":
      return "closet";
    case "storage":
      return "storage";
    case "utility":
      return "utility";
    case "other":
      return "other";
    default:
      return "generic";
  }
}

function normalizeRoomTypeForUi(roomType) {
  switch (roomType) {
    case "living_room":
    case "bedroom":
    case "kitchen":
    case "bathroom":
    case "toilet":
    case "hallway":
    case "closet":
    case "storage":
    case "utility":
    case "other":
    case "generic":
      return roomType;
    default:
      return DEFAULT_ROOM_TYPE;
  }
}

const ROOM_COLOR_PALETTE = [
  [56, 161, 105],
  [214, 93, 147],
  [71, 130, 218],
  [191, 132, 68],
  [132, 84, 214],
  [38, 156, 156],
  [166, 96, 176],
  [224, 118, 90]
];

function roomColor(roomId, alpha = 1) {
  const index = Math.abs(hashString(roomId)) % ROOM_COLOR_PALETTE.length;
  const [red, green, blue] = ROOM_COLOR_PALETTE[index];
  const resolvedAlpha = Number.isFinite(alpha) ? Math.max(0, Math.min(1, alpha)) : 1;
  return `rgba(${red}, ${green}, ${blue}, ${resolvedAlpha})`;
}

function hashString(value) {
  if (typeof value !== "string") {
    return 0;
  }
  let hash = 0;
  for (let index = 0; index < value.length; index += 1) {
    hash = ((hash << 5) - hash) + value.charCodeAt(index);
    hash |= 0;
  }
  return hash;
}

function normalizeRectangleGeometryUpdates(rectangles, updates, options = {}) {
  if (!Array.isArray(rectangles) || !Array.isArray(updates) || updates.length === 0) {
    return [];
  }
  const quantizationWorld = Number.isFinite(options.quantizationWorld) && options.quantizationWorld > 0
    ? options.quantizationWorld
    : null;
  const rectangleById = new Map(rectangles.map((rectangle) => [rectangle.id, rectangle]));
  const normalized = [];
  for (const update of updates) {
    const rectangleId = normalizeRectangleIdForUi(update?.id);
    if (!rectangleId) {
      continue;
    }
    const rectangle = rectangleById.get(rectangleId);
    if (!rectangle) {
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
    const geometry = quantizeRectangleGeometry({
      x: update.x,
      y: update.y,
      w: update.w,
      h: update.h
    }, quantizationWorld);
    if (!Number.isFinite(geometry.w) || !Number.isFinite(geometry.h) || geometry.w <= 0 || geometry.h <= 0) {
      continue;
    }
    normalized.push({
      id: rectangleId,
      x: geometry.x,
      y: geometry.y,
      w: geometry.w,
      h: geometry.h
    });
  }
  return normalized;
}

function buildRectanglesAfterGeometryUpdates(rectangles, updates) {
  const updateById = new Map(updates.map((update) => [update.id, update]));
  return rectangles.map((rectangle) => {
    const update = updateById.get(rectangle.id);
    if (!update) {
      return rectangle;
    }
    return {
      ...rectangle,
      x: update.x,
      y: update.y,
      w: update.w,
      h: update.h
    };
  });
}

function roomsConnectedAfterGeometryUpdates(plan, nextRectangles, updates) {
  const updatedRectangleIds = new Set(updates.map((update) => update.id));
  const currentRectangles = Array.isArray(plan?.entities?.rectangles) ? plan.entities.rectangles : [];
  const currentById = new Map(currentRectangles.map((rectangle) => [rectangle.id, rectangle]));
  const affectedRoomIds = new Set();

  for (const rectangleId of updatedRectangleIds) {
    const currentRectangle = currentById.get(rectangleId);
    const roomId = normalizeRectangleIdForUi(currentRectangle?.roomId);
    if (roomId) {
      affectedRoomIds.add(roomId);
    }
  }

  if (affectedRoomIds.size === 0) {
    return true;
  }

  const nextAdjacency = deriveTouchingAdjacency(nextRectangles, {
    metersPerWorldUnit: plan?.scale?.metersPerWorldUnit
  });
  const nextById = new Map(nextRectangles.map((rectangle) => [rectangle.id, rectangle]));
  const rooms = Array.isArray(plan?.entities?.rooms) ? plan.entities.rooms : [];

  for (const room of rooms) {
    const roomId = normalizeRectangleIdForUi(room?.id);
    if (!roomId || !affectedRoomIds.has(roomId)) {
      continue;
    }
    const roomRectangleIds = Array.isArray(room?.rectangleIds)
      ? room.rectangleIds.filter((rectangleId) => {
        const rectangle = nextById.get(rectangleId);
        return rectangle && rectangle.kind !== "wallRect" && rectangle.roomId === roomId;
      })
      : [];
    if (roomRectangleIds.length <= 1) {
      continue;
    }
    if (!isConnectedSelection(roomRectangleIds, nextAdjacency)) {
      return false;
    }
  }
  return true;
}

function hasPointerExceededDeadzone(dxScreen, dyScreen, deadzonePx) {
  if (!Number.isFinite(dxScreen) || !Number.isFinite(dyScreen)) {
    return false;
  }
  const threshold = Number.isFinite(deadzonePx) && deadzonePx > 0 ? deadzonePx : 0;
  return Math.hypot(dxScreen, dyScreen) >= threshold;
}

function getDragQuantizationWorld(metersPerWorldUnit) {
  if (!Number.isFinite(metersPerWorldUnit) || metersPerWorldUnit <= 0) {
    return DEFAULT_DRAG_QUANTIZATION_WORLD;
  }
  const quantization = METRIC_DRAG_QUANTIZATION_STEP_METERS / metersPerWorldUnit;
  return Number.isFinite(quantization) && quantization > 0
    ? quantization
    : DEFAULT_DRAG_QUANTIZATION_WORLD;
}

function quantizeAroundAnchor(value, anchor, step) {
  if (!Number.isFinite(value) || !Number.isFinite(anchor) || !Number.isFinite(step) || step <= 0) {
    return value;
  }
  return roundWorldPrecision(anchor + Math.round((value - anchor) / step) * step);
}

function quantizeWorldValue(value, step) {
  if (!Number.isFinite(value) || !Number.isFinite(step) || step <= 0) {
    return value;
  }
  return roundWorldPrecision(Math.round(value / step) * step);
}

function quantizeRectangleGeometry(rectangle, quantizationWorld) {
  if (!rectangle || typeof rectangle !== "object") {
    return rectangle;
  }
  if (!Number.isFinite(quantizationWorld) || quantizationWorld <= 0) {
    return {
      x: roundWorldPrecision(rectangle.x),
      y: roundWorldPrecision(rectangle.y),
      w: roundWorldPrecision(rectangle.w),
      h: roundWorldPrecision(rectangle.h)
    };
  }
  return {
    x: quantizeWorldValue(rectangle.x, quantizationWorld),
    y: quantizeWorldValue(rectangle.y, quantizationWorld),
    w: quantizeWorldValue(rectangle.w, quantizationWorld),
    h: quantizeWorldValue(rectangle.h, quantizationWorld)
  };
}

function roundWorldPrecision(value) {
  if (!Number.isFinite(value)) {
    return value;
  }
  return Math.round(value * 1_000_000) / 1_000_000;
}

function normalizeRectangleIdForUi(rectangleId) {
  if (typeof rectangleId !== "string") {
    return null;
  }
  const trimmed = rectangleId.trim();
  return trimmed || null;
}

function isInternalSeamSlideAdjustEnabled(editorState) {
  return Boolean(editorState?.mergeOptions?.allowInternalSeamAdjust);
}

function isGeometryEditingFrozen(editorState) {
  return Boolean(editorState?.editLocks?.geometryFrozen);
}

function deriveInternalSeamSlideStartDescriptor(plan, rectangleId, handleName) {
  const side = getSingleSideForResizeHandle(handleName);
  if (!side) {
    return null;
  }

  const rectangles = Array.isArray(plan?.entities?.rectangles) ? plan.entities.rectangles : [];
  const rectangleById = new Map(rectangles.map((rectangle) => [rectangle.id, rectangle]));
  const selectedRectangle = rectangleById.get(rectangleId);
  if (!selectedRectangle || selectedRectangle.kind === "wallRect") {
    return null;
  }

  const roomId = normalizeRectangleIdForUi(selectedRectangle.roomId);
  if (!roomId) {
    return null;
  }
  const roomSeams = deriveRoomSeams(plan, roomId, {
    metersPerWorldUnit: plan?.scale?.metersPerWorldUnit
  });
  const matchingSeams = roomSeams.seams.filter((seam) => (
    seam.rectangleAId === rectangleId && seam.sideA === side && seam.fullA
  ) || (
    seam.rectangleBId === rectangleId && seam.sideB === side && seam.fullB
  ));
  if (matchingSeams.length !== 1) {
    return null;
  }

  const seam = matchingSeams[0];
  const selectedIsA = seam.rectangleAId === rectangleId && seam.sideA === side;
  const partnerRectangleId = selectedIsA ? seam.rectangleBId : seam.rectangleAId;
  const partnerSide = selectedIsA ? seam.sideB : seam.sideA;
  const partnerRectangle = rectangleById.get(partnerRectangleId);
  if (!partnerRectangle || partnerRectangle.kind === "wallRect") {
    return null;
  }
  if (getOppositeSide(side) !== partnerSide) {
    return null;
  }

  const pair = buildInternalSeamPair(selectedRectangle, side, partnerRectangle);
  if (!pair) {
    return null;
  }

  return {
    axis: pair.axis,
    selectedRectangle: pair.selected,
    partnerRectangle: pair.partner
  };
}

function deriveInternalSeamSlideUpdates(seamSlideDescriptor, pointerWorld, options = {}) {
  if (!seamSlideDescriptor || !pointerWorld || !Number.isFinite(pointerWorld.x) || !Number.isFinite(pointerWorld.y)) {
    return [];
  }
  const minSize = Number.isFinite(options.minSize) && options.minSize > 0 ? options.minSize : 16;
  const axis = seamSlideDescriptor.axis;
  const rawCoordinate = axis === "vertical" ? pointerWorld.x : pointerWorld.y;
  if (!Number.isFinite(rawCoordinate)) {
    return [];
  }

  const selected = seamSlideDescriptor.selectedRectangle;
  const partner = seamSlideDescriptor.partnerRectangle;
  const minCoordinate = Math.max(selected.minCoordinate(minSize), partner.minCoordinate(minSize));
  const maxCoordinate = Math.min(selected.maxCoordinate(minSize), partner.maxCoordinate(minSize));
  if (!Number.isFinite(minCoordinate) || !Number.isFinite(maxCoordinate) || minCoordinate > maxCoordinate) {
    return [];
  }
  const coordinate = clampScreenValue(rawCoordinate, minCoordinate, maxCoordinate);
  const selectedUpdate = selected.fromCoordinate(coordinate);
  const partnerUpdate = partner.fromCoordinate(coordinate);

  if (!selectedUpdate || !partnerUpdate) {
    return [];
  }
  return [selectedUpdate, partnerUpdate];
}

function buildInternalSeamPair(selectedRectangle, selectedSide, partnerRectangle) {
  switch (selectedSide) {
    case "right":
      return {
        axis: "vertical",
        selected: {
          id: selectedRectangle.id,
          minCoordinate: (minSize) => selectedRectangle.x + minSize,
          maxCoordinate: () => Number.POSITIVE_INFINITY,
          fromCoordinate: (coordinate) => ({
            id: selectedRectangle.id,
            x: selectedRectangle.x,
            y: selectedRectangle.y,
            w: coordinate - selectedRectangle.x,
            h: selectedRectangle.h
          })
        },
        partner: {
          id: partnerRectangle.id,
          minCoordinate: () => Number.NEGATIVE_INFINITY,
          maxCoordinate: (minSize) => partnerRectangle.x + partnerRectangle.w - minSize,
          fromCoordinate: (coordinate) => ({
            id: partnerRectangle.id,
            x: coordinate,
            y: partnerRectangle.y,
            w: partnerRectangle.x + partnerRectangle.w - coordinate,
            h: partnerRectangle.h
          })
        }
      };

    case "left":
      return {
        axis: "vertical",
        selected: {
          id: selectedRectangle.id,
          minCoordinate: () => Number.NEGATIVE_INFINITY,
          maxCoordinate: (minSize) => selectedRectangle.x + selectedRectangle.w - minSize,
          fromCoordinate: (coordinate) => ({
            id: selectedRectangle.id,
            x: coordinate,
            y: selectedRectangle.y,
            w: selectedRectangle.x + selectedRectangle.w - coordinate,
            h: selectedRectangle.h
          })
        },
        partner: {
          id: partnerRectangle.id,
          minCoordinate: (minSize) => partnerRectangle.x + minSize,
          maxCoordinate: () => Number.POSITIVE_INFINITY,
          fromCoordinate: (coordinate) => ({
            id: partnerRectangle.id,
            x: partnerRectangle.x,
            y: partnerRectangle.y,
            w: coordinate - partnerRectangle.x,
            h: partnerRectangle.h
          })
        }
      };

    case "bottom":
      return {
        axis: "horizontal",
        selected: {
          id: selectedRectangle.id,
          minCoordinate: (minSize) => selectedRectangle.y + minSize,
          maxCoordinate: () => Number.POSITIVE_INFINITY,
          fromCoordinate: (coordinate) => ({
            id: selectedRectangle.id,
            x: selectedRectangle.x,
            y: selectedRectangle.y,
            w: selectedRectangle.w,
            h: coordinate - selectedRectangle.y
          })
        },
        partner: {
          id: partnerRectangle.id,
          minCoordinate: () => Number.NEGATIVE_INFINITY,
          maxCoordinate: (minSize) => partnerRectangle.y + partnerRectangle.h - minSize,
          fromCoordinate: (coordinate) => ({
            id: partnerRectangle.id,
            x: partnerRectangle.x,
            y: coordinate,
            w: partnerRectangle.w,
            h: partnerRectangle.y + partnerRectangle.h - coordinate
          })
        }
      };

    case "top":
      return {
        axis: "horizontal",
        selected: {
          id: selectedRectangle.id,
          minCoordinate: () => Number.NEGATIVE_INFINITY,
          maxCoordinate: (minSize) => selectedRectangle.y + selectedRectangle.h - minSize,
          fromCoordinate: (coordinate) => ({
            id: selectedRectangle.id,
            x: selectedRectangle.x,
            y: coordinate,
            w: selectedRectangle.w,
            h: selectedRectangle.y + selectedRectangle.h - coordinate
          })
        },
        partner: {
          id: partnerRectangle.id,
          minCoordinate: (minSize) => partnerRectangle.y + minSize,
          maxCoordinate: () => Number.POSITIVE_INFINITY,
          fromCoordinate: (coordinate) => ({
            id: partnerRectangle.id,
            x: partnerRectangle.x,
            y: partnerRectangle.y,
            w: partnerRectangle.w,
            h: coordinate - partnerRectangle.y
          })
        }
      };

    default:
      return null;
  }
}

function getSingleSideForResizeHandle(handleName) {
  switch (handleName) {
    case "n":
      return "top";
    case "e":
      return "right";
    case "s":
      return "bottom";
    case "w":
      return "left";
    default:
      return null;
  }
}

function getOppositeSide(side) {
  switch (side) {
    case "top":
      return "bottom";
    case "right":
      return "left";
    case "bottom":
      return "top";
    case "left":
      return "right";
    default:
      return null;
  }
}

function isResizeHandleBlockedByLockedSides(handleName, lockedSides) {
  if (!(lockedSides instanceof Set) || lockedSides.size === 0) {
    return false;
  }
  const affectedSides = getSidesForResizeHandle(handleName);
  if (affectedSides.length === 0) {
    return false;
  }
  return affectedSides.some((side) => lockedSides.has(side));
}

function getSidesForResizeHandle(handleName) {
  switch (handleName) {
    case "n":
      return ["top"];
    case "s":
      return ["bottom"];
    case "e":
      return ["right"];
    case "w":
      return ["left"];
    case "nw":
      return ["top", "left"];
    case "ne":
      return ["top", "right"];
    case "sw":
      return ["bottom", "left"];
    case "se":
      return ["bottom", "right"];
    default:
      return [];
  }
}

function normalizeWallSideValue(value) {
  if (!Number.isFinite(value) || value < 0) {
    return 0;
  }
  return Math.round(value * 10) / 10;
}

function drawSelectedRectangleDimensionLabels(ctx, editorState, plan, hover, cssWidth, cssHeight) {
  const rectangle = getSelectedRectangle(plan, editorState);
  if (!rectangle) {
    return;
  }

  const topLeft = worldToScreen(editorState.camera, rectangle.x, rectangle.y);
  const bottomRight = worldToScreen(editorState.camera, rectangle.x + rectangle.w, rectangle.y + rectangle.h);
  const left = Math.min(topLeft.x, bottomRight.x);
  const right = Math.max(topLeft.x, bottomRight.x);
  const top = Math.min(topLeft.y, bottomRight.y);
  const bottom = Math.max(topLeft.y, bottomRight.y);

  if (right < -48 || left > cssWidth + 48 || bottom < -48 || top > cssHeight + 48) {
    return;
  }

  const widthLabel = `W ${formatSelectedRectangleCanvasDimension(rectangle.w, plan.scale)}`;
  const heightLabel = `H ${formatSelectedRectangleCanvasDimension(rectangle.h, plan.scale)}`;
  const reservedRects = [{ x: 12, y: 12, w: 470, h: 138 }];
  if (hover.active) {
    reservedRects.push({ x: cssWidth - 180, y: 12, w: 168, h: 28 });
  }

  const widthCenterX = (left + right) / 2;
  const widthPlacement = chooseScreenLabelPlacement(
    ctx,
    widthLabel,
    [
      { x: widthCenterX, y: top - 10, anchorX: "center", anchorY: "bottom", side: "top" },
      { x: widthCenterX, y: bottom + 10, anchorX: "center", anchorY: "top", side: "bottom" }
    ],
    cssWidth,
    cssHeight,
    reservedRects
  );

  const heightCenterY = (top + bottom) / 2;
  const heightPlacement = chooseScreenLabelPlacement(
    ctx,
    heightLabel,
    [
      { x: right + 10, y: heightCenterY, anchorX: "left", anchorY: "middle", side: "right" },
      { x: left - 10, y: heightCenterY, anchorX: "right", anchorY: "middle", side: "left" }
    ],
    cssWidth,
    cssHeight,
    reservedRects
  );

  ctx.save();
  ctx.font = "12px Georgia, serif";
  ctx.textBaseline = "middle";
  ctx.lineWidth = 1;

  if (widthPlacement) {
    drawDimensionLeaderLine(ctx, {
      x0: widthCenterX,
      y0: widthPlacement.side === "top" ? top : bottom,
      x1: widthCenterX,
      y1: widthPlacement.side === "top" ? widthPlacement.box.y + widthPlacement.box.h : widthPlacement.box.y
    });
    drawDimensionLabelBubble(ctx, widthPlacement.box, widthLabel, {
      fillStyle: "rgba(35, 85, 235, 0.92)",
      strokeStyle: "rgba(19, 44, 125, 0.95)",
      textColor: "#ffffff"
    });
  }

  if (heightPlacement) {
    drawDimensionLeaderLine(ctx, {
      x0: heightPlacement.side === "right" ? right : left,
      y0: heightCenterY,
      x1: heightPlacement.side === "right" ? heightPlacement.box.x : heightPlacement.box.x + heightPlacement.box.w,
      y1: heightCenterY
    });
    drawDimensionLabelBubble(ctx, heightPlacement.box, heightLabel, {
      fillStyle: "rgba(178, 86, 15, 0.92)",
      strokeStyle: "rgba(110, 50, 8, 0.95)",
      textColor: "#ffffff"
    });
  }

  ctx.restore();
}

function formatSelectedRectangleCanvasDimension(worldLength, scale) {
  if (!Number.isFinite(worldLength) || worldLength < 0) {
    return "n/a";
  }

  const meters = worldLengthToMeters(worldLength, scale?.metersPerWorldUnit);
  if (meters == null) {
    return `${worldLength.toFixed(1)} wu`;
  }

  return formatMetersAndCentimeters(meters, {
    metersDecimals: 2,
    centimetersDecimals: 1
  }) ?? `${worldLength.toFixed(1)} wu`;
}

function chooseScreenLabelPlacement(ctx, label, candidates, cssWidth, cssHeight, reservedRects) {
  const measured = measureScreenLabelBox(ctx, label);
  for (const candidate of candidates) {
    const box = placeScreenLabelBox(measured, candidate, cssWidth, cssHeight);
    const collides = reservedRects.some((reserved) => screenRectsOverlap(box, reserved));
    if (!collides) {
      return { ...candidate, box };
    }
  }

  const fallbackBox = placeScreenLabelBox(measured, candidates[0], cssWidth, cssHeight);
  return { ...candidates[0], box: fallbackBox };
}

function measureScreenLabelBox(ctx, label) {
  ctx.save();
  ctx.font = "12px Georgia, serif";
  const textWidth = ctx.measureText(label).width;
  ctx.restore();
  const padX = 8;
  const padY = 4;
  const height = 22;
  return {
    w: Math.ceil(textWidth + padX * 2),
    h: height,
    padX,
    padY
  };
}

function placeScreenLabelBox(measured, candidate, cssWidth, cssHeight) {
  let x = candidate.x;
  let y = candidate.y;

  if (candidate.anchorX === "center") {
    x -= measured.w / 2;
  } else if (candidate.anchorX === "right") {
    x -= measured.w;
  }

  if (candidate.anchorY === "middle") {
    y -= measured.h / 2;
  } else if (candidate.anchorY === "bottom") {
    y -= measured.h;
  }

  return {
    x: clampScreenValue(x, 6, Math.max(6, cssWidth - measured.w - 6)),
    y: clampScreenValue(y, 6, Math.max(6, cssHeight - measured.h - 6)),
    w: measured.w,
    h: measured.h,
    padX: measured.padX,
    padY: measured.padY
  };
}

function drawDimensionLabelBubble(ctx, box, label, style) {
  ctx.save();
  ctx.fillStyle = style.fillStyle;
  ctx.strokeStyle = style.strokeStyle;
  ctx.lineWidth = 1;
  ctx.fillRect(box.x, box.y, box.w, box.h);
  ctx.strokeRect(box.x, box.y, box.w, box.h);

  ctx.fillStyle = style.textColor;
  ctx.font = "12px Georgia, serif";
  ctx.textBaseline = "middle";
  ctx.fillText(label, box.x + box.padX, box.y + box.h / 2);
  ctx.restore();
}

function drawDimensionLeaderLine(ctx, line) {
  ctx.save();
  ctx.strokeStyle = "rgba(31, 31, 31, 0.55)";
  ctx.lineWidth = 1;
  ctx.setLineDash([4, 3]);
  ctx.beginPath();
  ctx.moveTo(line.x0, line.y0);
  ctx.lineTo(line.x1, line.y1);
  ctx.stroke();
  ctx.setLineDash([]);
  ctx.restore();
}

function screenRectsOverlap(a, b) {
  return a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y;
}

function clampScreenValue(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function getRectanglesBounds(rectangles, options = {}) {
  if (!Array.isArray(rectangles) || rectangles.length === 0) {
    return null;
  }
  const getBounds = typeof options.getBounds === "function" ? options.getBounds : null;
  let minX = Number.POSITIVE_INFINITY;
  let minY = Number.POSITIVE_INFINITY;
  let maxX = Number.NEGATIVE_INFINITY;
  let maxY = Number.NEGATIVE_INFINITY;

  for (const rectangle of rectangles) {
    const bounds = getBounds ? getBounds(rectangle) : rectangle;
    if (!bounds || !Number.isFinite(bounds.x) || !Number.isFinite(bounds.y) || !Number.isFinite(bounds.w) || !Number.isFinite(bounds.h)) {
      continue;
    }
    minX = Math.min(minX, bounds.x);
    minY = Math.min(minY, bounds.y);
    maxX = Math.max(maxX, bounds.x + bounds.w);
    maxY = Math.max(maxY, bounds.y + bounds.h);
  }

  if (!Number.isFinite(minX) || !Number.isFinite(minY) || !Number.isFinite(maxX) || !Number.isFinite(maxY)) {
    return null;
  }

  return {
    x: minX,
    y: minY,
    w: Math.max(0, maxX - minX),
    h: Math.max(0, maxY - minY)
  };
}

function formatBackgroundImageStatus(backgroundImageState) {
  switch (backgroundImageState?.status) {
    case "ready":
      return "loaded";
    case "loading":
      return "loading";
    case "error":
      return "load error";
    default:
      return "idle";
  }
}

function drawGrid(ctx, camera, cssWidth, cssHeight) {
  const major = 100;
  const minor = 20;
  const left = camera.x;
  const top = camera.y;
  const right = camera.x + cssWidth / camera.zoom;
  const bottom = camera.y + cssHeight / camera.zoom;

  ctx.lineWidth = 1 / camera.zoom;

  const minorStartX = Math.floor(left / minor) * minor;
  const minorStartY = Math.floor(top / minor) * minor;
  ctx.strokeStyle = "rgba(0, 0, 0, 0.05)";
  for (let x = minorStartX; x < right; x += minor) {
    ctx.beginPath();
    ctx.moveTo(x, top);
    ctx.lineTo(x, bottom);
    ctx.stroke();
  }
  for (let y = minorStartY; y < bottom; y += minor) {
    ctx.beginPath();
    ctx.moveTo(left, y);
    ctx.lineTo(right, y);
    ctx.stroke();
  }

  const majorStartX = Math.floor(left / major) * major;
  const majorStartY = Math.floor(top / major) * major;
  ctx.strokeStyle = "rgba(0, 0, 0, 0.12)";
  for (let x = majorStartX; x < right; x += major) {
    ctx.beginPath();
    ctx.moveTo(x, top);
    ctx.lineTo(x, bottom);
    ctx.stroke();
  }
  for (let y = majorStartY; y < bottom; y += major) {
    ctx.beginPath();
    ctx.moveTo(left, y);
    ctx.lineTo(right, y);
    ctx.stroke();
  }
}

function drawBackgroundFrame(ctx, plan, backgroundImageState) {
  const background = plan.background;
  if (!background?.transform) return;

  const { x, y, width, height } = background.transform;
  const opacity = Math.max(0, Math.min(1, background.opacity ?? 0.35));
  const image = backgroundImageState?.status === "ready" ? backgroundImageState.image : null;

  if (image) {
    ctx.save();
    ctx.globalAlpha = opacity;
    ctx.imageSmoothingEnabled = true;
    ctx.drawImage(image, x, y, width, height);
    ctx.restore();
  } else {
    ctx.save();
    ctx.fillStyle = "rgba(11, 110, 79, 0.03)";
    ctx.fillRect(x, y, width, height);
    ctx.restore();
  }

  ctx.save();
  ctx.strokeStyle = "rgba(11, 110, 79, 0.25)";
  ctx.lineWidth = 1.2;
  ctx.setLineDash([10, 8]);
  ctx.strokeRect(x, y, width, height);
  if (!image) {
    ctx.setLineDash([]);
    ctx.fillStyle = "rgba(11, 110, 79, 0.55)";
    ctx.font = "14px Georgia, serif";
    ctx.textBaseline = "top";
    ctx.fillText(
      backgroundImageState?.status === "error" ? "Background image failed to load" : "Background image loading...",
      x + 10,
      y + 10
    );
    ctx.setLineDash([10, 8]);
  }
  ctx.setLineDash([]);
  ctx.restore();
}

function getSelectedRectangle(plan, editorState) {
  const selectedId = editorState.selection.rectangleId;
  if (!selectedId) {
    return null;
  }
  return plan.entities.rectangles.find((rectangle) => rectangle.id === selectedId) ?? null;
}

function getSelectedLightingFixture(plan, editorState) {
  const fixtureId = normalizeRectangleIdForUi(editorState?.lightingSelection?.fixtureId);
  if (!fixtureId) {
    return null;
  }
  return getLightingFixtureById(plan, fixtureId);
}

function getSelectedOpening(plan, editorState) {
  const openingId = normalizeRectangleIdForUi(editorState?.openingSelection?.openingId);
  if (!openingId) {
    return null;
  }
  return getOpeningById(plan, openingId);
}

function getLightingFixtureById(plan, fixtureId) {
  const normalizedFixtureId = normalizeRectangleIdForUi(fixtureId);
  if (!normalizedFixtureId) {
    return null;
  }
  const fixtures = getLightingCollections(plan).fixtures;
  return fixtures.find((fixture) => fixture?.id === normalizedFixtureId) ?? null;
}

function getOpeningById(plan, openingId) {
  const normalizedOpeningId = normalizeRectangleIdForUi(openingId);
  if (!normalizedOpeningId) {
    return null;
  }
  const openings = Array.isArray(plan?.entities?.openings) ? plan.entities.openings : [];
  return openings.find((opening) => opening?.id === normalizedOpeningId) ?? null;
}

function getRoomForRectangle(plan, rectangle) {
  const roomId = rectangle?.roomId;
  if (typeof roomId !== "string" || !roomId) {
    return null;
  }
  const rooms = Array.isArray(plan?.entities?.rooms) ? plan.entities.rooms : [];
  return rooms.find((room) => room?.id === roomId) ?? null;
}

function deriveSidebarRooms(plan) {
  const rectangles = Array.isArray(plan?.entities?.rectangles) ? plan.entities.rectangles : [];
  const rooms = Array.isArray(plan?.entities?.rooms) ? plan.entities.rooms : [];
  const groupedRectangleIdsByEntryId = new Map();
  const roomEntryMetadataById = new Map();

  for (const rectangle of rectangles) {
    if (!rectangle || rectangle.kind === "wallRect") {
      continue;
    }
    const entryId = deriveRoomEntryIdForRectangle(rectangle);
    if (!groupedRectangleIdsByEntryId.has(entryId)) {
      groupedRectangleIdsByEntryId.set(entryId, []);
    }
    groupedRectangleIdsByEntryId.get(entryId).push(rectangle.id);

    if (!roomEntryMetadataById.has(entryId)) {
      const roomId = normalizeRectangleIdForUi(rectangle.roomId);
      roomEntryMetadataById.set(entryId, {
        roomId,
        roomType: DEFAULT_ROOM_TYPE,
        name: roomId ? roomId : rectangle.id
      });
    }
  }

  const roomEntityById = new Map(
    rooms
      .filter((room) => room && typeof room.id === "string" && room.id)
      .map((room) => [room.id, room])
  );

  const roomEntries = [];
  for (const [entryId, rectangleIds] of groupedRectangleIdsByEntryId.entries()) {
    const metadata = roomEntryMetadataById.get(entryId) ?? null;
    const roomId = normalizeRectangleIdForUi(metadata?.roomId);
    const roomEntity = roomId ? (roomEntityById.get(roomId) ?? null) : null;
    const roomName = normalizeRoomEntryName(roomEntity?.name, metadata?.name ?? entryId);
    roomEntries.push({
      id: entryId,
      roomId,
      name: roomName,
      roomType: normalizeRoomTypeForUi(roomEntity?.roomType),
      rectangleIds: Array.from(new Set(rectangleIds))
    });
  }

  roomEntries.sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: "base" }) || a.id.localeCompare(b.id));
  return roomEntries;
}

function deriveEffectiveActiveRoomId(plan, editorState, roomEntries = null) {
  const entries = Array.isArray(roomEntries) ? roomEntries : deriveSidebarRooms(plan);
  const roomIdSet = new Set(entries.map((entry) => entry.id));
  const selectedRectangle = getSelectedRectangle(plan, editorState);
  const selectedRoomEntryId = selectedRectangle ? deriveRoomEntryIdForRectangle(selectedRectangle) : null;
  if (selectedRoomEntryId && roomIdSet.has(selectedRoomEntryId)) {
    return selectedRoomEntryId;
  }
  const selectedRoomFromSidebar = normalizeRectangleIdForUi(editorState?.roomSelection?.roomId);
  if (selectedRoomFromSidebar && roomIdSet.has(selectedRoomFromSidebar)) {
    return selectedRoomFromSidebar;
  }
  return null;
}

function getActiveRoomEntry(plan, editorState, roomEntries = null) {
  const entries = Array.isArray(roomEntries) ? roomEntries : deriveSidebarRooms(plan);
  const activeRoomId = deriveEffectiveActiveRoomId(plan, editorState, entries);
  if (!activeRoomId) {
    return null;
  }
  return entries.find((entry) => entry.id === activeRoomId) ?? null;
}

function normalizeRoomEntryName(name, fallbackId) {
  if (typeof name === "string" && name.trim()) {
    return name.trim();
  }
  return fallbackId;
}

function deriveRoomEntryIdForRectangle(rectangle) {
  const roomId = normalizeRectangleIdForUi(rectangle?.roomId);
  if (roomId) {
    return `room:${roomId}`;
  }
  const rectangleId = normalizeRectangleIdForUi(rectangle?.id);
  return rectangleId ? `rect:${rectangleId}` : "rect:unknown";
}

function getPlanViewState(plan) {
  const rawView = plan?.view;
  return {
    roomHighlighting: rawView?.roomHighlighting !== false,
    wallsBlack: Boolean(rawView?.wallsBlack)
  };
}

function isBaseboardOverlayEnabled(editorState) {
  return Boolean(editorState?.debug?.showBaseboardOverlay);
}

function isBaseboardConflictOverlayEnabled(editorState) {
  return Boolean(editorState?.debug?.showBaseboardConflictOverlay);
}

function drawDebugRectangles(
  ctx,
  plan,
  selectedRectangleId,
  camera,
  mergeSelectionIds = [],
  activeRoomId = null,
  lockedSeamSides = null
) {
  const metersPerWorldUnit = plan?.scale?.metersPerWorldUnit;
  const mergeSelectionSet = new Set(
    Array.isArray(mergeSelectionIds)
      ? mergeSelectionIds.filter((rectangleId) => typeof rectangleId === "string" && rectangleId)
      : []
  );
  const innerSeamIntervalsByRectangle = collectInternalSeamIntervalsByRectangle(plan, {
    includeWallShell: false
  });
  const outerSeamIntervalsByRectangle = collectInternalSeamIntervalsByRectangle(plan, {
    includeWallShell: true
  });
  const hasActiveRoom = typeof activeRoomId === "string" && activeRoomId;
  const planView = getPlanViewState(plan);
  const roomHighlighting = planView.roomHighlighting;
  const wallsBlack = planView.wallsBlack;
  const selectedRectangle = plan.entities.rectangles.find((rectangle) => rectangle.id === selectedRectangleId) ?? null;
  const selectedRoomEntryId = selectedRectangle?.kind !== "wallRect"
    ? deriveRoomEntryIdForRectangle(selectedRectangle)
    : null;
  const selectedGroupRectangleIds = new Set(
    selectedRoomEntryId
      ? plan.entities.rectangles
        .filter((rectangle) => rectangle.kind !== "wallRect" && deriveRoomEntryIdForRectangle(rectangle) === selectedRoomEntryId)
        .map((rectangle) => rectangle.id)
      : []
  );

  for (const rect of plan.entities.rectangles) {
    const isWall = rect.kind === "wallRect";
    const roomEntryId = !isWall ? deriveRoomEntryIdForRectangle(rect) : null;
    const roomStroke = roomEntryId ? roomColor(roomEntryId, 0.95) : null;
    const roomFill = roomEntryId ? roomColor(roomEntryId, 0.18) : null;
    const isActiveRoomMember = !isWall && hasActiveRoom && roomEntryId === activeRoomId;
    const isNonActiveRoomMember = !isWall && hasActiveRoom && roomEntryId && roomEntryId !== activeRoomId;
    const wallStroke = wallsBlack ? "#000" : "#222";
    const wallFill = wallsBlack ? "rgba(0,0,0,0.82)" : "rgba(20,20,20,0.20)";
    const neutralRoomStroke = "rgba(88, 88, 88, 0.94)";
    const neutralRoomFill = "rgba(255,255,255,0.96)";
    const stroke = isWall
      ? wallStroke
      : (roomHighlighting ? (roomStroke ?? "#0b6e4f") : neutralRoomStroke);
    const fill = isWall
      ? wallFill
      : (roomHighlighting ? (roomFill ?? "rgba(11,110,79,0.14)") : neutralRoomFill);
    const isSelected = rect.id === selectedRectangleId;
    const isSelectedGroupMember = !isWall && selectedGroupRectangleIds.has(rect.id);
    const shell = deriveRectangleShellGeometry(rect, metersPerWorldUnit);
    const outerRect = shell?.outerRect ?? rect;
    const wallBands = shell?.wallBands ?? null;
    const hiddenSides = !isWall && lockedSeamSides instanceof Map
      ? lockedSeamSides.get(rect.id) ?? null
      : null;
    const hiddenInnerIntervalsBySide = !isWall
      ? innerSeamIntervalsByRectangle.get(rect.id) ?? null
      : null;
    const hiddenOuterIntervalsBySide = !isWall
      ? outerSeamIntervalsByRectangle.get(rect.id) ?? null
      : null;
    const sideVisibility = {
      top: !(hiddenSides instanceof Set && hiddenSides.has("top")),
      right: !(hiddenSides instanceof Set && hiddenSides.has("right")),
      bottom: !(hiddenSides instanceof Set && hiddenSides.has("bottom")),
      left: !(hiddenSides instanceof Set && hiddenSides.has("left"))
    };

    ctx.save();
    if (wallBands && !isWall) {
      ctx.fillStyle = wallsBlack ? "rgba(0,0,0,0.72)" : "rgba(15, 42, 34, 0.22)";
      for (const band of Object.values(wallBands)) {
        if (!band) {
          continue;
        }
        ctx.fillRect(band.x, band.y, band.w, band.h);
      }
      ctx.strokeStyle = wallsBlack ? "rgba(0,0,0,0.96)" : "rgba(15, 42, 34, 0.45)";
      ctx.lineWidth = 1 / camera.zoom;
      strokeRectSides(ctx, outerRect, sideVisibility, hiddenOuterIntervalsBySide);
    }

    ctx.fillStyle = fill;
    ctx.strokeStyle = stroke;
    ctx.globalAlpha = isNonActiveRoomMember ? 0.62 : 1;
    ctx.lineWidth = isWall ? 2 : (isActiveRoomMember ? 2.2 : 1.5);
    ctx.fillRect(rect.x, rect.y, rect.w, rect.h);
    if (isWall) {
      ctx.strokeRect(rect.x, rect.y, rect.w, rect.h);
    } else {
      strokeRectSides(ctx, rect, sideVisibility, hiddenInnerIntervalsBySide);
    }
    ctx.globalAlpha = 1;

    if (rect.label) {
      ctx.fillStyle = "rgba(31,31,31,0.9)";
      ctx.font = "12px Georgia, serif";
      ctx.textBaseline = "top";
      ctx.fillText(rect.label, rect.x + 6, rect.y + 6);
    }

    if (isSelectedGroupMember) {
      ctx.fillStyle = isSelected ? "rgba(35, 85, 235, 0.14)" : "rgba(35, 85, 235, 0.08)";
      ctx.fillRect(rect.x, rect.y, rect.w, rect.h);
      ctx.strokeStyle = "rgba(35, 85, 235, 0.98)";
      ctx.lineWidth = isSelected ? 3 / camera.zoom : 2.2 / camera.zoom;
      strokeRectSides(ctx, outerRect, sideVisibility, hiddenOuterIntervalsBySide);
    }

    if (mergeSelectionSet.has(rect.id) && rect.kind !== "wallRect") {
      ctx.strokeStyle = "rgba(138, 63, 252, 0.98)";
      ctx.lineWidth = 2 / camera.zoom;
      ctx.setLineDash([7 / camera.zoom, 5 / camera.zoom]);
      strokeRectSides(ctx, outerRect, sideVisibility, hiddenOuterIntervalsBySide);
      ctx.setLineDash([]);
    }

    ctx.restore();
  }
}

function drawLightingLinks(ctx, plan, editorState, camera) {
  const lighting = getLightingCollections(plan);
  if (lighting.links.length === 0 || lighting.fixtures.length === 0) {
    return;
  }

  const fixtureById = new Map(
    lighting.fixtures
      .filter((fixture) => typeof fixture?.id === "string" && fixture.id)
      .map((fixture) => [fixture.id, fixture])
  );
  const activeSwitchId = normalizeRectangleIdForUi(editorState?.lightingSelection?.linkSwitchId);

  ctx.save();
  ctx.lineWidth = 1.6 / camera.zoom;
  const switchStatesById = isPlainObjectValue(editorState?.lightingPreview?.switchStatesById)
    ? editorState.lightingPreview.switchStatesById
    : {};
  for (const link of lighting.links) {
    const switchFixture = fixtureById.get(link?.switchId);
    if (!switchFixture || switchFixture.kind !== "switch") {
      continue;
    }
    const targets = resolveLightingLinkTargetPoints(link, fixtureById);
    if (targets.length === 0) {
      continue;
    }

    const isActive = activeSwitchId != null && switchFixture.id === activeSwitchId;
    const switchOn = switchStatesById[switchFixture.id] !== false;
    ctx.strokeStyle = switchOn
      ? (isActive ? "rgba(204, 91, 0, 0.98)" : "rgba(145, 92, 44, 0.58)")
      : "rgba(135, 135, 135, 0.48)";
    ctx.setLineDash(isActive ? [] : [7 / camera.zoom, 6 / camera.zoom]);
    for (const target of targets) {
      ctx.beginPath();
      ctx.moveTo(switchFixture.x, switchFixture.y);
      ctx.lineTo(target.x, target.y);
      ctx.stroke();
    }
  }
  ctx.setLineDash([]);
  ctx.restore();
}

function resolveLightingLinkTargetPoints(link, fixtureById) {
  if (!link || !(fixtureById instanceof Map)) {
    return [];
  }
  if (link.targetType !== "lamp") {
    return [];
  }
  const lamp = fixtureById.get(link.targetId);
  if (!lamp || lamp.kind !== "lamp") {
    return [];
  }
  return [{ x: lamp.x, y: lamp.y }];
}

function drawLightingFixtures(ctx, plan, editorState, camera) {
  const lighting = getLightingCollections(plan);
  if (lighting.fixtures.length === 0) {
    return;
  }
  const selectedFixtureId = normalizeRectangleIdForUi(editorState?.lightingSelection?.fixtureId);
  const linkSwitchId = normalizeRectangleIdForUi(editorState?.lightingSelection?.linkSwitchId);
  const switchStatesById = isPlainObjectValue(editorState?.lightingPreview?.switchStatesById)
    ? editorState.lightingPreview.switchStatesById
    : {};
  const lampPowerById = deriveLampPowerStateByLampId(lighting, switchStatesById);

  for (const fixture of lighting.fixtures) {
    if (!Number.isFinite(fixture?.x) || !Number.isFinite(fixture?.y)) {
      continue;
    }
    const isSelected = fixture.id === selectedFixtureId;
    const isLinkSwitch = fixture.id === linkSwitchId;
    const radius = fixture.kind === "switch"
      ? FIXTURE_SWITCH_RADIUS_WORLD / camera.zoom
      : FIXTURE_LAMP_RADIUS_WORLD / camera.zoom;

    ctx.save();
    if (fixture.kind === "switch") {
      const switchOn = switchStatesById[fixture.id] !== false;
      ctx.fillStyle = switchOn
        ? (isLinkSwitch ? "rgba(207, 106, 19, 0.98)" : "rgba(176, 106, 40, 0.95)")
        : "rgba(136, 136, 136, 0.9)";
      ctx.strokeStyle = isSelected ? "rgba(35, 85, 235, 0.98)" : "rgba(77, 46, 13, 0.98)";
      ctx.lineWidth = isSelected ? 2.2 / camera.zoom : 1.5 / camera.zoom;
      ctx.fillRect(fixture.x - radius, fixture.y - radius, radius * 2, radius * 2);
      ctx.strokeRect(fixture.x - radius, fixture.y - radius, radius * 2, radius * 2);
    } else {
      const lampOn = lampPowerById.get(fixture.id) !== false;
      ctx.fillStyle = lampOn ? "rgba(245, 219, 76, 0.96)" : "rgba(167, 167, 167, 0.78)";
      ctx.strokeStyle = isSelected ? "rgba(35, 85, 235, 0.98)" : "rgba(107, 90, 16, 0.98)";
      ctx.lineWidth = isSelected ? 2.2 / camera.zoom : 1.3 / camera.zoom;
      ctx.beginPath();
      ctx.arc(fixture.x, fixture.y, radius, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
    }

    if (isSelected) {
      ctx.strokeStyle = "rgba(35, 85, 235, 0.38)";
      ctx.lineWidth = 4 / camera.zoom;
      ctx.beginPath();
      ctx.arc(fixture.x, fixture.y, radius + 5 / camera.zoom, 0, Math.PI * 2);
      ctx.stroke();
    }
    ctx.restore();
  }
}

function deriveLampPowerStateByLampId(lighting, switchStatesById) {
  const fixtureById = new Map(
    lighting.fixtures
      .filter((fixture) => typeof fixture?.id === "string" && fixture.id)
      .map((fixture) => [fixture.id, fixture])
  );
  const lampIds = new Set(
    lighting.fixtures
      .filter((fixture) => fixture?.kind === "lamp" && typeof fixture?.id === "string" && fixture.id)
      .map((fixture) => fixture.id)
  );
  const controllingSwitchIdsByLampId = new Map(
    Array.from(lampIds).map((lampId) => [lampId, new Set()])
  );

  for (const link of lighting.links) {
    const switchId = normalizeRectangleIdForUi(link?.switchId);
    if (!switchId) {
      continue;
    }
    const switchFixture = fixtureById.get(switchId);
    if (!switchFixture || switchFixture.kind !== "switch") {
      continue;
    }
    if (link?.targetType === "lamp") {
      const lampId = normalizeRectangleIdForUi(link?.targetId);
      if (lampId && controllingSwitchIdsByLampId.has(lampId)) {
        controllingSwitchIdsByLampId.get(lampId).add(switchId);
      }
    }
  }

  const lampPower = new Map();
  for (const lampId of lampIds) {
    const controllers = controllingSwitchIdsByLampId.get(lampId) ?? new Set();
    if (controllers.size === 0) {
      lampPower.set(lampId, true);
      continue;
    }
    const anyOn = Array.from(controllers).some((switchId) => switchStatesById[switchId] !== false);
    lampPower.set(lampId, anyOn);
  }
  return lampPower;
}

function hitTestLightingFixtures(plan, worldPoint, zoom) {
  const lighting = getLightingCollections(plan);
  if (lighting.fixtures.length === 0) {
    return null;
  }
  const hitRadiusWorld = FIXTURE_HIT_RADIUS_PX / Math.max(0.2, zoom);
  let best = null;
  let bestDistance = Number.POSITIVE_INFINITY;
  for (const fixture of lighting.fixtures) {
    if (!Number.isFinite(fixture?.x) || !Number.isFinite(fixture?.y)) {
      continue;
    }
    const distance = Math.hypot(worldPoint.x - fixture.x, worldPoint.y - fixture.y);
    if (distance <= hitRadiusWorld && distance < bestDistance) {
      best = fixture;
      bestDistance = distance;
    }
  }
  if (!best) {
    return null;
  }
  return { fixture: best, distanceWorld: bestDistance };
}

function hitTestOpenings(plan, worldPoint, zoom) {
  const openings = Array.isArray(plan?.entities?.openings) ? plan.entities.openings : [];
  if (openings.length === 0) {
    return null;
  }
  const toleranceWorld = OPENING_HIT_DISTANCE_PX / Math.max(0.2, zoom);
  let best = null;
  let bestDistance = Number.POSITIVE_INFINITY;

  for (const opening of openings) {
    const geometry = deriveOpeningGeometry(plan, opening);
    if (!geometry) {
      continue;
    }
    const { side, startAlong, endAlong } = geometry;
    const pointerAlong = deriveOpeningAlongCoordinate(side, worldPoint) - deriveOpeningAlongBase(geometry);
    const pointerAcross = deriveOpeningAcrossCoordinate(side, worldPoint) - deriveOpeningAcrossBase(geometry);
    if (pointerAlong < startAlong - toleranceWorld || pointerAlong > endAlong + toleranceWorld) {
      continue;
    }
    const distance = Math.abs(pointerAcross);
    if (distance <= toleranceWorld && distance < bestDistance) {
      best = {
        opening,
        geometry,
        distanceWorld: distance,
        pointerAlong,
        centerAlong: geometry.centerAlong
      };
      bestDistance = distance;
    }
  }

  return best;
}

function hitTestOpeningResizeHandles(plan, opening, worldPoint, zoom) {
  const geometry = deriveOpeningGeometry(plan, opening);
  if (!geometry) {
    return null;
  }
  const handleSizeWorld = OPENING_HANDLE_SIZE_PX / Math.max(0.2, zoom);
  const half = handleSizeWorld / 2;
  const handles = [
    { edge: "start", x: geometry.startX, y: geometry.startY },
    { edge: "end", x: geometry.endX, y: geometry.endY }
  ];
  for (const handle of handles) {
    if (
      worldPoint.x >= handle.x - half &&
      worldPoint.x <= handle.x + half &&
      worldPoint.y >= handle.y - half &&
      worldPoint.y <= handle.y + half
    ) {
      return { opening, geometry, edge: handle.edge };
    }
  }
  return null;
}

function drawOpenings(ctx, plan, editorState, camera) {
  const openings = Array.isArray(plan?.entities?.openings) ? plan.entities.openings : [];
  if (openings.length === 0) {
    return;
  }
  const selectedOpeningId = normalizeRectangleIdForUi(editorState?.openingSelection?.openingId);

  for (const opening of openings) {
    const geometry = deriveOpeningGeometry(plan, opening);
    if (!geometry) {
      continue;
    }
    const isSelected = opening.id === selectedOpeningId;
    const stroke = opening.kind === "door"
      ? "rgba(38, 94, 214, 0.92)"
      : "rgba(26, 138, 158, 0.92)";

    ctx.save();
    ctx.strokeStyle = stroke;
    ctx.lineCap = "round";
    ctx.lineWidth = (isSelected ? 8 : 6) / camera.zoom;
    ctx.beginPath();
    ctx.moveTo(geometry.startX, geometry.startY);
    ctx.lineTo(geometry.endX, geometry.endY);
    ctx.stroke();

    if (isSelected) {
      const handleSize = OPENING_HANDLE_SIZE_PX / camera.zoom;
      const half = handleSize / 2;
      ctx.fillStyle = "rgba(255,255,255,0.97)";
      ctx.strokeStyle = "rgba(35, 85, 235, 0.98)";
      ctx.lineWidth = 1.6 / camera.zoom;
      for (const handlePoint of [
        { x: geometry.startX, y: geometry.startY },
        { x: geometry.endX, y: geometry.endY }
      ]) {
        ctx.fillRect(handlePoint.x - half, handlePoint.y - half, handleSize, handleSize);
        ctx.strokeRect(handlePoint.x - half, handlePoint.y - half, handleSize, handleSize);
      }
    }
    ctx.restore();
  }
}

function deriveOpeningPlacementAtPoint(plan, worldPoint, zoom = 1) {
  const rectangles = Array.isArray(plan?.entities?.rectangles) ? plan.entities.rectangles : [];
  const maxDistanceWorld = OPENING_HIT_DISTANCE_PX / Math.max(0.2, zoom);
  let best = null;
  let bestDistance = Number.POSITIVE_INFINITY;

  for (let index = rectangles.length - 1; index >= 0; index -= 1) {
    const rectangle = rectangles[index];
    if (!rectangle || !Number.isFinite(rectangle.x) || !Number.isFinite(rectangle.y) || !Number.isFinite(rectangle.w) || !Number.isFinite(rectangle.h)) {
      continue;
    }
    if (
      worldPoint.x < rectangle.x ||
      worldPoint.x > rectangle.x + rectangle.w ||
      worldPoint.y < rectangle.y ||
      worldPoint.y > rectangle.y + rectangle.h
    ) {
      continue;
    }
    const projection = projectPointToRectangleSideAny(rectangle, worldPoint);
    if (!projection || !isRectangleSideWallCapable(rectangle, projection.side)) {
      continue;
    }
    if (projection.distanceWorld > maxDistanceWorld) {
      continue;
    }
    if (projection.distanceWorld < bestDistance) {
      bestDistance = projection.distanceWorld;
      best = {
        x: projection.x,
        y: projection.y,
        host: {
          type: "wallSide",
          rectangleId: rectangle.id,
          side: projection.side,
          offset: projection.offset
        }
      };
    }
  }

  return best;
}

function deriveOpeningGeometry(plan, opening) {
  const rectangleId = normalizeRectangleIdForUi(opening?.host?.rectangleId);
  const side = normalizeWallSideForUi(opening?.host?.side);
  const offsetRaw = Number.isFinite(opening?.host?.offset) ? opening.host.offset : 0.5;
  if (!rectangleId || !side) {
    return null;
  }
  const rectangles = Array.isArray(plan?.entities?.rectangles) ? plan.entities.rectangles : [];
  const rectangle = rectangles.find((candidate) => candidate?.id === rectangleId) ?? null;
  if (!rectangle || !isRectangleSideWallCapable(rectangle, side)) {
    return null;
  }

  const sideLength = (side === "top" || side === "bottom") ? rectangle.w : rectangle.h;
  if (!Number.isFinite(sideLength) || sideLength <= 0) {
    return null;
  }
  const minWidth = Math.max(1, Math.min(MIN_OPENING_WIDTH_WORLD, sideLength));
  const widthWorld = clampScreenValue(
    Number.isFinite(opening?.widthWorld) ? opening.widthWorld : DEFAULT_OPENING_WIDTH_WORLD,
    minWidth,
    sideLength
  );
  const halfWidth = widthWorld / 2;
  const centerAlong = clampScreenValue(offsetRaw * sideLength, halfWidth, sideLength - halfWidth);
  const startAlong = centerAlong - halfWidth;
  const endAlong = centerAlong + halfWidth;
  const offset = sideLength > 0 ? centerAlong / sideLength : 0.5;

  if (side === "top" || side === "bottom") {
    const y = side === "top" ? rectangle.y : rectangle.y + rectangle.h;
    return {
      opening,
      rectangle,
      side,
      sideLength,
      widthWorld,
      offset,
      centerAlong,
      startAlong,
      endAlong,
      centerX: rectangle.x + centerAlong,
      centerY: y,
      startX: rectangle.x + startAlong,
      startY: y,
      endX: rectangle.x + endAlong,
      endY: y
    };
  }

  const x = side === "left" ? rectangle.x : rectangle.x + rectangle.w;
  return {
    opening,
    rectangle,
    side,
    sideLength,
    widthWorld,
    offset,
    centerAlong,
    startAlong,
    endAlong,
    centerX: x,
    centerY: rectangle.y + centerAlong,
    startX: x,
    startY: rectangle.y + startAlong,
    endX: x,
    endY: rectangle.y + endAlong
  };
}

function deriveOpeningAlongCoordinate(side, point) {
  return side === "top" || side === "bottom"
    ? point.x
    : point.y;
}

function deriveOpeningAlongBase(geometry) {
  return geometry.side === "top" || geometry.side === "bottom"
    ? geometry.rectangle.x
    : geometry.rectangle.y;
}

function deriveOpeningAcrossCoordinate(side, point) {
  return side === "top" || side === "bottom"
    ? point.y
    : point.x;
}

function deriveOpeningAcrossBase(geometry) {
  if (geometry.side === "top") {
    return geometry.rectangle.y;
  }
  if (geometry.side === "bottom") {
    return geometry.rectangle.y + geometry.rectangle.h;
  }
  if (geometry.side === "left") {
    return geometry.rectangle.x;
  }
  return geometry.rectangle.x + geometry.rectangle.w;
}

function isRectangleSideWallCapable(rectangle, side) {
  if (!rectangle || !side) {
    return false;
  }
  if (rectangle.kind === "wallRect") {
    return true;
  }
  const wallCm = normalizeWallCm(rectangle.wallCm);
  return wallCm[side] > 0;
}

function normalizeWallSideForUi(side) {
  if (side === "top" || side === "right" || side === "bottom" || side === "left") {
    return side;
  }
  return null;
}

function deriveSwitchPlacementAtPoint(plan, worldPoint, selectedRectangleId = null) {
  const rectangles = Array.isArray(plan?.entities?.rectangles) ? plan.entities.rectangles : [];
  const selectedRectangle = rectangles.find((rectangle) => rectangle?.id === selectedRectangleId) ?? null;
  const hitRectangle = findRoomRectangleAtPoint(rectangles, worldPoint);
  const hostRectangle = hitRectangle ?? selectedRectangle;
  if (!hostRectangle || hostRectangle.kind === "wallRect") {
    return null;
  }
  const projection = projectPointToRectangleSide(hostRectangle, worldPoint);
  if (!projection) {
    return null;
  }
  return {
    x: projection.x,
    y: projection.y,
    roomId: normalizeRectangleIdForUi(hostRectangle.roomId),
    host: {
      type: "wallSide",
      rectangleId: hostRectangle.id,
      side: projection.side,
      offset: projection.offset
    }
  };
}

function projectPointToSwitchHostSide(plan, host, point) {
  const rectangleId = normalizeRectangleIdForUi(host?.rectangleId);
  const side = host?.side;
  if (!rectangleId || (side !== "top" && side !== "right" && side !== "bottom" && side !== "left")) {
    return null;
  }
  const rectangles = Array.isArray(plan?.entities?.rectangles) ? plan.entities.rectangles : [];
  const rectangle = rectangles.find((candidate) => candidate?.id === rectangleId) ?? null;
  if (!rectangle || rectangle.kind === "wallRect") {
    return null;
  }

  if (side === "top" || side === "bottom") {
    const x = clampScreenValue(point.x, rectangle.x, rectangle.x + rectangle.w);
    const y = side === "top" ? rectangle.y : rectangle.y + rectangle.h;
    const offset = rectangle.w > 0 ? (x - rectangle.x) / rectangle.w : 0;
    return { x, y, host: { type: "wallSide", rectangleId, side, offset } };
  }

  const y = clampScreenValue(point.y, rectangle.y, rectangle.y + rectangle.h);
  const x = side === "left" ? rectangle.x : rectangle.x + rectangle.w;
  const offset = rectangle.h > 0 ? (y - rectangle.y) / rectangle.h : 0;
  return { x, y, host: { type: "wallSide", rectangleId, side, offset } };
}

function projectSwitchFixtureToHostPosition(rectangle, side, rawOffset) {
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
  const offset = Number.isFinite(rawOffset) ? Math.min(1, Math.max(0, rawOffset)) : null;
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

function projectPointToRectangleSide(rectangle, point) {
  if (!rectangle || rectangle.kind === "wallRect") {
    return null;
  }
  return projectPointToRectangleSideAny(rectangle, point);
}

function projectPointToRectangleSideAny(rectangle, point) {
  if (!rectangle) {
    return null;
  }
  const x = point.x;
  const y = point.y;
  const leftDistance = Math.abs(x - rectangle.x);
  const rightDistance = Math.abs(x - (rectangle.x + rectangle.w));
  const topDistance = Math.abs(y - rectangle.y);
  const bottomDistance = Math.abs(y - (rectangle.y + rectangle.h));
  const minimum = Math.min(leftDistance, rightDistance, topDistance, bottomDistance);

  if (minimum === topDistance) {
    const projectedX = clampScreenValue(x, rectangle.x, rectangle.x + rectangle.w);
    return {
      side: "top",
      x: projectedX,
      y: rectangle.y,
      offset: rectangle.w > 0 ? (projectedX - rectangle.x) / rectangle.w : 0,
      distanceWorld: topDistance
    };
  }
  if (minimum === bottomDistance) {
    const projectedX = clampScreenValue(x, rectangle.x, rectangle.x + rectangle.w);
    return {
      side: "bottom",
      x: projectedX,
      y: rectangle.y + rectangle.h,
      offset: rectangle.w > 0 ? (projectedX - rectangle.x) / rectangle.w : 0,
      distanceWorld: bottomDistance
    };
  }
  if (minimum === leftDistance) {
    const projectedY = clampScreenValue(y, rectangle.y, rectangle.y + rectangle.h);
    return {
      side: "left",
      x: rectangle.x,
      y: projectedY,
      offset: rectangle.h > 0 ? (projectedY - rectangle.y) / rectangle.h : 0,
      distanceWorld: leftDistance
    };
  }
  const projectedY = clampScreenValue(y, rectangle.y, rectangle.y + rectangle.h);
  return {
    side: "right",
    x: rectangle.x + rectangle.w,
    y: projectedY,
    offset: rectangle.h > 0 ? (projectedY - rectangle.y) / rectangle.h : 0,
    distanceWorld: rightDistance
  };
}

function findRoomRectangleAtPoint(rectangles, worldPoint) {
  if (!Array.isArray(rectangles)) {
    return null;
  }
  for (let index = rectangles.length - 1; index >= 0; index -= 1) {
    const rectangle = rectangles[index];
    if (!rectangle || rectangle.kind === "wallRect") {
      continue;
    }
    if (
      worldPoint.x >= rectangle.x &&
      worldPoint.x <= rectangle.x + rectangle.w &&
      worldPoint.y >= rectangle.y &&
      worldPoint.y <= rectangle.y + rectangle.h
    ) {
      return rectangle;
    }
  }
  return null;
}

function deriveRoomIdFromPoint(plan, worldPoint) {
  const rectangle = findRoomRectangleAtPoint(plan?.entities?.rectangles, worldPoint);
  return normalizeRectangleIdForUi(rectangle?.roomId);
}

function deriveLampInteriorHostFromRectangle(rectangle, point) {
  if (
    !rectangle ||
    rectangle.kind === "wallRect" ||
    !Number.isFinite(point?.x) ||
    !Number.isFinite(point?.y)
  ) {
    return {
      type: "roomInterior"
    };
  }
  return {
    type: "roomInterior",
    rectangleId: rectangle.id,
    offsetX: point.x - rectangle.x,
    offsetY: point.y - rectangle.y
  };
}

function strokeRectSides(ctx, rect, visibleSides = null, hiddenIntervalsBySide = null) {
  if (!ctx || !rect) {
    return;
  }
  const showTop = visibleSides == null ? true : visibleSides.top !== false;
  const showRight = visibleSides == null ? true : visibleSides.right !== false;
  const showBottom = visibleSides == null ? true : visibleSides.bottom !== false;
  const showLeft = visibleSides == null ? true : visibleSides.left !== false;
  if (!showTop && !showRight && !showBottom && !showLeft) {
    return;
  }
  const topSegments = showTop
    ? deriveVisibleSideSegments(rect.x, rect.x + rect.w, hiddenIntervalsBySide?.top)
    : [];
  const rightSegments = showRight
    ? deriveVisibleSideSegments(rect.y, rect.y + rect.h, hiddenIntervalsBySide?.right)
    : [];
  const bottomSegments = showBottom
    ? deriveVisibleSideSegments(rect.x, rect.x + rect.w, hiddenIntervalsBySide?.bottom)
    : [];
  const leftSegments = showLeft
    ? deriveVisibleSideSegments(rect.y, rect.y + rect.h, hiddenIntervalsBySide?.left)
    : [];
  if (
    topSegments.length === 0 &&
    rightSegments.length === 0 &&
    bottomSegments.length === 0 &&
    leftSegments.length === 0
  ) {
    return;
  }
  ctx.beginPath();
  for (const segment of topSegments) {
    ctx.moveTo(segment.start, rect.y);
    ctx.lineTo(segment.end, rect.y);
  }
  for (const segment of rightSegments) {
    ctx.moveTo(rect.x + rect.w, segment.start);
    ctx.lineTo(rect.x + rect.w, segment.end);
  }
  for (const segment of bottomSegments) {
    ctx.moveTo(segment.start, rect.y + rect.h);
    ctx.lineTo(segment.end, rect.y + rect.h);
  }
  for (const segment of leftSegments) {
    ctx.moveTo(rect.x, segment.start);
    ctx.lineTo(rect.x, segment.end);
  }
  ctx.stroke();
}

function collectInternalSeamIntervalsByRectangle(plan, options = {}) {
  const rectangles = Array.isArray(plan?.entities?.rectangles) ? plan.entities.rectangles : [];
  const includeWallShell = options.includeWallShell !== false;
  const roomIds = new Set(
    rectangles
      .filter((rectangle) => rectangle?.kind !== "wallRect" && typeof rectangle?.roomId === "string" && rectangle.roomId)
      .map((rectangle) => rectangle.roomId)
  );
  if (roomIds.size === 0) {
    return new Map();
  }

  const intervalsByRectangle = new Map();
  for (const roomId of roomIds) {
    const roomSeams = deriveRoomSeams(plan, roomId, {
      metersPerWorldUnit: plan.scale?.metersPerWorldUnit,
      touchToleranceWorld: 2,
      includeWallShell
    });
    for (const seam of roomSeams.seams) {
      appendHiddenSeamInterval(intervalsByRectangle, seam.rectangleAId, seam.sideA, seam.overlapStart, seam.overlapEnd);
      appendHiddenSeamInterval(intervalsByRectangle, seam.rectangleBId, seam.sideB, seam.overlapStart, seam.overlapEnd);
    }
  }

  for (const [rectangleId, sideMap] of intervalsByRectangle.entries()) {
    intervalsByRectangle.set(rectangleId, {
      top: mergeIntervals(sideMap.top),
      right: mergeIntervals(sideMap.right),
      bottom: mergeIntervals(sideMap.bottom),
      left: mergeIntervals(sideMap.left)
    });
  }
  return intervalsByRectangle;
}

function appendHiddenSeamInterval(intervalsByRectangle, rectangleId, side, start, end) {
  if (
    !(intervalsByRectangle instanceof Map) ||
    typeof rectangleId !== "string" ||
    !rectangleId ||
    (side !== "top" && side !== "right" && side !== "bottom" && side !== "left")
  ) {
    return;
  }
  if (!Number.isFinite(start) || !Number.isFinite(end)) {
    return;
  }
  const intervalStart = Math.min(start, end);
  const intervalEnd = Math.max(start, end);
  if (intervalEnd - intervalStart <= 1e-6) {
    return;
  }
  if (!intervalsByRectangle.has(rectangleId)) {
    intervalsByRectangle.set(rectangleId, {
      top: [],
      right: [],
      bottom: [],
      left: []
    });
  }
  intervalsByRectangle.get(rectangleId)[side].push({
    start: intervalStart,
    end: intervalEnd
  });
}

function deriveVisibleSideSegments(sideStart, sideEnd, hiddenIntervals = null, epsilon = 1e-6) {
  const minSide = Math.min(sideStart, sideEnd);
  const maxSide = Math.max(sideStart, sideEnd);
  if (maxSide - minSide <= epsilon) {
    return [];
  }
  const hidden = mergeIntervals(hiddenIntervals)
    .map((interval) => ({
      start: Math.max(minSide, interval.start),
      end: Math.min(maxSide, interval.end)
    }))
    .filter((interval) => interval.end - interval.start > epsilon);
  if (hidden.length === 0) {
    return [{ start: minSide, end: maxSide }];
  }
  const visible = [];
  let cursor = minSide;
  for (const interval of hidden) {
    if (interval.start > cursor + epsilon) {
      visible.push({ start: cursor, end: interval.start });
    }
    cursor = Math.max(cursor, interval.end);
  }
  if (maxSide > cursor + epsilon) {
    visible.push({ start: cursor, end: maxSide });
  }
  return visible;
}

function mergeIntervals(intervals) {
  const normalized = Array.isArray(intervals)
    ? intervals
      .filter((interval) => interval && Number.isFinite(interval.start) && Number.isFinite(interval.end))
      .map((interval) => ({
        start: Math.min(interval.start, interval.end),
        end: Math.max(interval.start, interval.end)
      }))
      .filter((interval) => interval.end - interval.start > 1e-6)
      .sort((left, right) => left.start - right.start)
    : [];
  if (normalized.length === 0) {
    return [];
  }
  const merged = [normalized[0]];
  for (let index = 1; index < normalized.length; index += 1) {
    const current = normalized[index];
    const tail = merged[merged.length - 1];
    if (current.start <= tail.end + 1e-6) {
      tail.end = Math.max(tail.end, current.end);
      continue;
    }
    merged.push(current);
  }
  return merged;
}

function drawValidationOverlapFlash(ctx, plan, validation, camera, timestamp) {
  const overlapPairs = Array.isArray(validation?.overlapPairs) ? validation.overlapPairs : [];
  if (overlapPairs.length === 0) {
    return;
  }

  const rectangles = plan?.entities?.rectangles ?? [];
  const overlapRectangles = collectUniqueOverlapRectangles(rectangles, overlapPairs);
  if (overlapRectangles.length === 0) {
    return;
  }

  const flashState = getActiveOverlapFlashState(validation, timestamp);
  if (!flashState) {
    return;
  }

  const metersPerWorldUnit = plan?.scale?.metersPerWorldUnit;
  const highlightedRectangles = [
    resolveOverlapPairRectangle(rectangles, flashState.pair?.aIndex, flashState.pair?.aId),
    resolveOverlapPairRectangle(rectangles, flashState.pair?.bIndex, flashState.pair?.bId)
  ].filter(Boolean);

  ctx.save();
  ctx.strokeStyle = "rgba(255, 183, 0, 0.9)";
  ctx.lineWidth = 2.2 / camera.zoom;
  ctx.setLineDash([9 / camera.zoom, 7 / camera.zoom]);
  for (const rectangle of overlapRectangles) {
    const bounds = getRectangleOuterRect(rectangle, metersPerWorldUnit) ?? rectangle;
    ctx.strokeRect(bounds.x, bounds.y, bounds.w, bounds.h);
  }
  ctx.setLineDash([]);
  ctx.restore();

  if (highlightedRectangles.length === 0) {
    return;
  }

  const fillAlpha = flashState.flashOn ? 0.22 : 0.09;
  const strokeAlpha = flashState.flashOn ? 0.98 : 0.52;
  const strokeWidth = flashState.flashOn ? 4.4 : 2.4;

  ctx.save();
  ctx.fillStyle = `rgba(188, 38, 255, ${fillAlpha})`;
  ctx.strokeStyle = `rgba(188, 38, 255, ${strokeAlpha})`;
  ctx.lineWidth = strokeWidth / camera.zoom;

  for (const rectangle of highlightedRectangles) {
    const bounds = getRectangleOuterRect(rectangle, metersPerWorldUnit) ?? rectangle;
    ctx.fillRect(bounds.x, bounds.y, bounds.w, bounds.h);
    ctx.strokeRect(bounds.x, bounds.y, bounds.w, bounds.h);

    ctx.beginPath();
    ctx.moveTo(bounds.x, bounds.y);
    ctx.lineTo(bounds.x + bounds.w, bounds.y + bounds.h);
    ctx.moveTo(bounds.x + bounds.w, bounds.y);
    ctx.lineTo(bounds.x, bounds.y + bounds.h);
    ctx.stroke();
  }

  ctx.restore();
}

function buildPlanShellRectangles(plan) {
  const metersPerWorldUnit = plan?.scale?.metersPerWorldUnit;
  const shellRectangles = [];

  for (const rectangle of plan.entities.rectangles) {
    const outerRect = getRectangleOuterRect(rectangle, metersPerWorldUnit);
    if (!outerRect) {
      continue;
    }
    shellRectangles.push({
      id: rectangle.id,
      x: outerRect.x,
      y: outerRect.y,
      w: outerRect.w,
      h: outerRect.h
    });
  }

  return shellRectangles;
}

function getRectangleHitBounds(rectangle, scale) {
  return getRectangleOuterRect(rectangle, scale?.metersPerWorldUnit);
}

function drawBaseboardDebugSegments(ctx, baseboard, camera) {
  if (!baseboard) {
    return;
  }
  const countedSegments = Array.isArray(baseboard.segments) ? baseboard.segments : [];
  const excludedSegments = Array.isArray(baseboard.excludedSegments) ? baseboard.excludedSegments : [];
  const unsupportedOpenSides = Array.isArray(baseboard.unsupportedOpenSides) ? baseboard.unsupportedOpenSides : [];
  if (countedSegments.length === 0 && excludedSegments.length === 0 && unsupportedOpenSides.length === 0) {
    return;
  }

  ctx.save();
  ctx.lineCap = "round";

  if (excludedSegments.length > 0) {
    ctx.strokeStyle = "rgba(214, 124, 24, 0.95)";
    ctx.lineWidth = 5 / camera.zoom;
    ctx.setLineDash([12 / camera.zoom, 8 / camera.zoom]);
    for (const segment of excludedSegments) {
      ctx.beginPath();
      ctx.moveTo(segment.x0, segment.y0);
      ctx.lineTo(segment.x1, segment.y1);
      ctx.stroke();
    }
    ctx.setLineDash([]);
  }

  if (countedSegments.length > 0) {
    ctx.strokeStyle = "rgba(212, 30, 30, 0.95)";
    ctx.lineWidth = 5 / camera.zoom;
    for (const segment of countedSegments) {
      ctx.beginPath();
      ctx.moveTo(segment.x0, segment.y0);
      ctx.lineTo(segment.x1, segment.y1);
      ctx.stroke();
    }
  }

  if (unsupportedOpenSides.length > 0) {
    ctx.strokeStyle = "rgba(32, 92, 194, 0.94)";
    ctx.lineWidth = 4 / camera.zoom;
    ctx.setLineDash([8 / camera.zoom, 6 / camera.zoom]);
    for (const segment of unsupportedOpenSides) {
      ctx.beginPath();
      ctx.moveTo(segment.x0, segment.y0);
      ctx.lineTo(segment.x1, segment.y1);
      ctx.stroke();
    }
    ctx.setLineDash([]);
  }

  ctx.restore();
}

function drawBaseboardConflictSegments(ctx, conflicts, camera) {
  const segments = Array.isArray(conflicts?.segments) ? conflicts.segments : [];
  if (segments.length === 0) {
    return;
  }

  ctx.save();
  ctx.strokeStyle = "rgba(192, 32, 143, 0.95)";
  ctx.lineWidth = 7 / camera.zoom;
  ctx.setLineDash([10 / camera.zoom, 6 / camera.zoom]);
  ctx.lineCap = "round";

  for (const segment of segments) {
    ctx.beginPath();
    ctx.moveTo(segment.x0, segment.y0);
    ctx.lineTo(segment.x1, segment.y1);
    ctx.stroke();
  }

  ctx.setLineDash([]);
  ctx.restore();
}

function drawSelectedResizeHandles(ctx, plan, editorState, lockedSeamSides = null) {
  const selectedRectangle = getSelectedRectangle(plan, editorState);
  if (!selectedRectangle) {
    return;
  }

  const handles = getResizeHandles(selectedRectangle, editorState.camera.zoom, {
    handleSizePx: HANDLE_SIZE_PX
  });

  ctx.save();
  ctx.fillStyle = "rgba(255,255,255,0.95)";
  ctx.strokeStyle = "rgba(35, 85, 235, 0.95)";
  ctx.lineWidth = 1.5 / editorState.camera.zoom;
  const lockedSides = lockedSeamSides?.get(selectedRectangle.id) ?? null;
  const allowInternalSlideAdjust = isInternalSeamSlideAdjustEnabled(editorState);

  for (const handle of handles) {
    const isLocked = isResizeHandleBlockedByLockedSides(handle.name, lockedSides);
    const canSlideInternalSeam = isLocked &&
      allowInternalSlideAdjust &&
      Boolean(deriveInternalSeamSlideStartDescriptor(plan, selectedRectangle.id, handle.name));

    if (canSlideInternalSeam) {
      ctx.fillStyle = "rgba(255, 214, 138, 0.96)";
      ctx.strokeStyle = "rgba(163, 101, 12, 0.98)";
    } else if (isLocked) {
      ctx.fillStyle = "rgba(145, 145, 145, 0.95)";
      ctx.strokeStyle = "rgba(85, 85, 85, 0.95)";
    } else {
      ctx.fillStyle = "rgba(255,255,255,0.95)";
      ctx.strokeStyle = "rgba(35, 85, 235, 0.95)";
    }
    ctx.fillRect(handle.x, handle.y, handle.w, handle.h);
    ctx.strokeRect(handle.x, handle.y, handle.w, handle.h);
  }

  ctx.restore();
}

function drawDraftRectangle(ctx, editorState, camera) {
  const draft = editorState.interaction.drawRectDraft;
  if (!draft) {
    return;
  }

  const rect = normalizeRectangleFromPoints(draft.startWorld, draft.currentWorld);
  if (rect.w === 0 && rect.h === 0) {
    return;
  }

  ctx.save();
  ctx.fillStyle = "rgba(35, 85, 235, 0.10)";
  ctx.strokeStyle = "rgba(35, 85, 235, 0.9)";
  ctx.lineWidth = 1.5 / camera.zoom;
  ctx.setLineDash([8 / camera.zoom, 6 / camera.zoom]);
  ctx.fillRect(rect.x, rect.y, rect.w, rect.h);
  ctx.strokeRect(rect.x, rect.y, rect.w, rect.h);
  ctx.setLineDash([]);
  ctx.restore();
}

function drawScaleReferenceLine(ctx, plan, camera) {
  const referenceLine = plan?.scale?.referenceLine;
  const metersPerWorldUnit = plan?.scale?.metersPerWorldUnit;
  if (
    !referenceLine ||
    !Number.isFinite(referenceLine.x0) ||
    !Number.isFinite(referenceLine.y0) ||
    !Number.isFinite(referenceLine.x1) ||
    !Number.isFinite(referenceLine.y1)
  ) {
    return;
  }

  ctx.save();
  ctx.strokeStyle = "rgba(178, 86, 15, 0.95)";
  ctx.fillStyle = "rgba(178, 86, 15, 0.95)";
  ctx.lineWidth = 2 / camera.zoom;
  ctx.setLineDash([10 / camera.zoom, 7 / camera.zoom]);
  ctx.beginPath();
  ctx.moveTo(referenceLine.x0, referenceLine.y0);
  ctx.lineTo(referenceLine.x1, referenceLine.y1);
  ctx.stroke();
  ctx.setLineDash([]);

  const midX = (referenceLine.x0 + referenceLine.x1) / 2;
  const midY = (referenceLine.y0 + referenceLine.y1) / 2;
  const label = Number.isFinite(metersPerWorldUnit)
    ? `${referenceLine.meters}m (${metersPerWorldUnit.toFixed(4)} m/u)`
    : `${referenceLine.meters}m`;
  ctx.font = `${12 / camera.zoom}px Georgia, serif`;
  ctx.textBaseline = "bottom";
  ctx.fillText(label, midX + 6 / camera.zoom, midY - 6 / camera.zoom);

  drawCalibrationEndpoint(ctx, referenceLine.x0, referenceLine.y0, camera);
  drawCalibrationEndpoint(ctx, referenceLine.x1, referenceLine.y1, camera);
  ctx.restore();
}

function drawCalibrationDraftLine(ctx, editorState, camera) {
  const draft = editorState.interaction.calibrationDraft;
  if (!draft) {
    return;
  }

  const start = draft.startWorld;
  const end = draft.currentWorld;
  const length = distanceBetweenWorldPoints(start, end);
  if (!Number.isFinite(length) || length <= 0) {
    return;
  }

  ctx.save();
  ctx.strokeStyle = "rgba(178, 86, 15, 0.9)";
  ctx.fillStyle = "rgba(178, 86, 15, 0.9)";
  ctx.lineWidth = 2 / camera.zoom;
  ctx.setLineDash([8 / camera.zoom, 6 / camera.zoom]);
  ctx.beginPath();
  ctx.moveTo(start.x, start.y);
  ctx.lineTo(end.x, end.y);
  ctx.stroke();
  ctx.setLineDash([]);

  drawCalibrationEndpoint(ctx, start.x, start.y, camera);
  drawCalibrationEndpoint(ctx, end.x, end.y, camera);

  const midX = (start.x + end.x) / 2;
  const midY = (start.y + end.y) / 2;
  ctx.font = `${12 / camera.zoom}px Georgia, serif`;
  ctx.textBaseline = "bottom";
  ctx.fillText(`${length.toFixed(1)} world units`, midX + 6 / camera.zoom, midY - 6 / camera.zoom);
  ctx.restore();
}

function drawCalibrationEndpoint(ctx, x, y, camera) {
  const radius = 4 / camera.zoom;
  ctx.beginPath();
  ctx.arc(x, y, radius, 0, Math.PI * 2);
  ctx.fill();
}

function drawWorldAxes(ctx, camera, cssWidth, cssHeight) {
  const left = camera.x;
  const top = camera.y;
  const right = camera.x + cssWidth / camera.zoom;
  const bottom = camera.y + cssHeight / camera.zoom;

  ctx.save();
  ctx.lineWidth = 2 / camera.zoom;

  if (0 >= left && 0 <= right) {
    ctx.strokeStyle = "rgba(200, 40, 40, 0.35)";
    ctx.beginPath();
    ctx.moveTo(0, top);
    ctx.lineTo(0, bottom);
    ctx.stroke();
  }

  if (0 >= top && 0 <= bottom) {
    ctx.strokeStyle = "rgba(40, 60, 200, 0.35)";
    ctx.beginPath();
    ctx.moveTo(left, 0);
    ctx.lineTo(right, 0);
    ctx.stroke();
  }

  ctx.restore();
}
