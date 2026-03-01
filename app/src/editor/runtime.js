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
  createPlanAutosaveController,
  loadPersistedPlan,
  parseImportedPlanJsonText
} from "./persistence/local-plan-storage.js";
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
const MIN_CALIBRATION_LINE_WORLD = 8;
const WALL_CM_STEP = 1;
const DEFAULT_ROOM_TYPE = "generic";
const OVERLAP_FLASH_PAIR_DURATION_MS = 1100;
const OVERLAP_FLASH_BLINK_PERIOD_MS = 320;

export function mountEditorRuntime(options) {
  const { canvas, statusElement, overlayElement, shellElement, controls = {} } = options;
  const context = canvas.getContext("2d");
  if (!context) {
    throw new Error("2D canvas context is required");
  }

  const persistedPlanLoad = loadPersistedPlan();
  const initialPlan = persistedPlanLoad.plan ?? createEmptyPlan();
  let persistenceStatus = {
    loadSource: persistedPlanLoad.source,
    phase: "idle",
    lastSavedAt: null,
    lastActionType: null,
    errorMessage: persistedPlanLoad.error
      ? (persistedPlanLoad.error instanceof Error ? persistedPlanLoad.error.message : String(persistedPlanLoad.error))
      : null
  };

  const store = createEditorSessionStore({
    plan: initialPlan,
    editorState: createInitialEditorState()
  });

  const autosaveController = createPlanAutosaveController(store, {
    onStatus(nextStatus) {
      persistenceStatus = {
        ...persistenceStatus,
        ...nextStatus
      };
    }
  });

  if (!persistedPlanLoad.plan) {
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
  let lastLockedSeamsPlan = null;
  let lastLockedSeamSides = null;
  let nextUserRectangleId = deriveNextUserRectangleId(store.getState().plan);

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
    const worldPoint = screenToWorld(editorState.camera, point.x, point.y);
    const selectedRectangle = getSelectedRectangle(plan, editorState);

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
      store.dispatch({ type: "editor/selection/clear" });
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

    if (editorState.tool === "mergeRoom") {
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
      syncRoomSelectionFromRectangle(hit.rectangle);
      store.dispatch({
        type: "editor/merge/toggleRectangle",
        rectangleId: hit.rectangle.id
      });
      syncEditorChrome();
      return;
    }

    const lockedSeamSides = getLockedSeamSides(plan);
    if (selectedRectangle) {
      const handleHit = hitTestResizeHandles(selectedRectangle, worldPoint, editorState.camera.zoom, {
        handleSizePx: HANDLE_SIZE_PX
      });
      if (handleHit) {
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
      const dragOffset = computeRectangleDragOffset(hit.rectangle, worldPoint);

      store.dispatch({
        type: "editor/selection/set",
        rectangleId: hit.rectangle.id
      });
      syncRoomSelectionFromRectangle(hit.rectangle);
      canvas.setPointerCapture(event.pointerId);
      store.dispatch({
        type: "editor/interaction/rectDragStart",
        pointerId: event.pointerId,
        screenX: event.clientX,
        screenY: event.clientY,
        rectangleId: hit.rectangle.id,
        offsetX: dragOffset.x,
        offsetY: dragOffset.y
      });
      syncEditorChrome();
      return;
    }

    store.dispatch({ type: "editor/selection/clear" });
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
      const worldPoint = screenToWorld(state.editorState.camera, point.x, point.y);
      const dragRectangle = state.editorState.interaction.dragRectangle;
      const nextPosition = computeRectanglePositionFromPointer(worldPoint, {
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

      const dragGroupRectangleIds = getDragGroupRectangleIds(state.plan, draggedRectangle);
      const dx = nextPosition.x - draggedRectangle.x;
      const dy = nextPosition.y - draggedRectangle.y;

      if (dragGroupRectangleIds.length > 1) {
        if (dx !== 0 || dy !== 0) {
          const dragGroupRectangleIdSet = new Set(dragGroupRectangleIds);
          let groupDx = dx;
          let groupDy = dy;
          const snapWallWorld = getRectangleWallWorld(draggedRectangle, state.plan.scale?.metersPerWorldUnit);
          const proposedDraggedRectangle = {
            x: nextPosition.x,
            y: nextPosition.y,
            w: draggedRectangle.w,
            h: draggedRectangle.h
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
              groupDx = snappedDraggedInterior.x - draggedRectangle.x;
              groupDy = snappedDraggedInterior.y - draggedRectangle.y;
            }
          }

          const groupUpdates = dragGroupRectangleIds.map((rectangleId) => {
            const rectangle = state.plan.entities.rectangles.find((candidate) => candidate.id === rectangleId);
            return rectangle
              ? {
                  id: rectangle.id,
                  x: rectangle.x + groupDx,
                  y: rectangle.y + groupDy,
                  w: rectangle.w,
                  h: rectangle.h
                }
              : null;
          }).filter(Boolean);
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

      const proposedRectangle = draggedRectangle
        ? {
            x: nextPosition.x,
            y: nextPosition.y,
            w: draggedRectangle.w,
            h: draggedRectangle.h
          }
        : { x: nextPosition.x, y: nextPosition.y, w: 0, h: 0 };
      let snappedRectangle = proposedRectangle;
      if (draggedRectangle) {
        const snapWallWorld = getRectangleWallWorld(draggedRectangle, state.plan.scale?.metersPerWorldUnit);
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
      state.editorState.interaction.mode === "drawingRect" &&
      state.editorState.interaction.pointerId === event.pointerId &&
      state.editorState.interaction.drawRectDraft
    ) {
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
        const rectangleId = `rect_user_${nextUserRectangleId++}`;
        store.dispatch({
          type: "plan/rectangles/create",
          rectangleId,
          x: nextRect.x,
          y: nextRect.y,
          w: nextRect.w,
          h: nextRect.h
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

  canvas.addEventListener("pointerdown", onPointerDown);
  canvas.addEventListener("pointermove", onPointerMove);
  canvas.addEventListener("pointerup", onPointerUp);
  canvas.addEventListener("pointercancel", onPointerCancel);
  canvas.addEventListener("pointerleave", onPointerLeave);
  canvas.addEventListener("wheel", onWheel, { passive: false });

  if (controls.resetViewButton) {
    controls.resetViewButton.addEventListener("click", () => {
      store.dispatch({ type: "editor/camera/reset" });
    });
  }

  if (controls.resetPlanButton) {
    controls.resetPlanButton.addEventListener("click", () => {
      store.dispatch({ type: "plan/replace", plan: createEmptyPlan() });
      store.dispatch({ type: "editor/selection/clear" });
      store.dispatch({ type: "editor/interaction/end", pointerId: null });
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

  if (controls.baseboardDebugToggleButton) {
    controls.baseboardDebugToggleButton.addEventListener("click", () => {
      store.dispatch({ type: "editor/debug/toggleBaseboardOverlay" });
    });
  }

  if (controls.deleteSelectedButton) {
    controls.deleteSelectedButton.addEventListener("click", () => {
      deleteSelectedRectangle();
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
      const item = target.closest("[data-room-item-id]");
      if (!(item instanceof HTMLElement)) {
        return;
      }
      const roomId = item.dataset.roomItemId;
      activateRoomFromSidebar(roomId, { center: false });
    });

    controls.roomListElement.addEventListener("dblclick", (event) => {
      const target = event.target;
      if (!(target instanceof HTMLElement)) {
        return;
      }
      const item = target.closest("[data-room-item-id]");
      if (!(item instanceof HTMLElement)) {
        return;
      }
      const roomId = item.dataset.roomItemId;
      activateRoomFromSidebar(roomId, { center: true });
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
      store.dispatch({ type: "editor/interaction/end", pointerId: null });
      store.dispatch({ type: "editor/tool/set", tool: "navigate" });
      nextUserRectangleId = deriveNextUserRectangleId(importedPlan);
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
    if (!didDelete) {
      return;
    }
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
    if (showBaseboardOverlay) {
      drawBaseboardDebugSegments(ctx, baseboard, camera);
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
    ctx.fillRect(12, 12, 470, 154);
    ctx.strokeRect(12, 12, 470, 154);

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
      const overlapFlashLabel = formatValidationOverlapFlashStatus(validation, timestamp);
      const baseboardLabel = formatBaseboardSummaryStatus(baseboard, showBaseboardOverlay);
      const fileIoLabel = formatFileTransferStatusShort(fileTransferStatus);
      const mergeSelectionCount = Array.isArray(editorState.mergeSelection?.rectangleIds)
        ? editorState.mergeSelection.rectangleIds.length
        : 0;
      const internalSlideMode = isInternalSeamSlideAdjustEnabled(editorState) ? "slides:on" : "slides:off";
      const activeRoomId = deriveEffectiveActiveRoomId(plan, editorState);
      statusElement.textContent =
        `T-0024 merge room v1 | ${backgroundLabel} | ${scaleLabel} | ${autosaveLabel} | ${validationLabel} | overlap ${overlapFlashLabel} | ${baseboardLabel} | file ${fileIoLabel} | tool ${tool} | pan | wheel zoom | ` +
        `camera ${camera.x.toFixed(1)}, ${camera.y.toFixed(1)} | ` +
        `zoom ${camera.zoom.toFixed(2)}x | merge ${mergeSelectionCount} ${internalSlideMode} | active-room ${activeRoomId ?? "none"} | ` +
        `rects ${plan.entities.rectangles.length} | selected ${selectedId}${selectedKindLabel ? ` (${selectedKindLabel})` : ""}${selectedDimsLabel ? ` ${selectedDimsLabel}` : ""}${selectedWallLabel ? ` [${selectedWallLabel}]` : ""}${selectedRoomLabel ? ` {${selectedRoomLabel}}` : ""} | ` +
        `fps ~${fps.toFixed(0)}`;
    }

    if (overlayElement) {
      const selectedRectangle = getSelectedRectangle(plan, editorState);
      overlayElement.innerHTML =
        `T-0024 active (manual room merge + seam locks). Image: ${formatBackgroundImageStatus(backgroundImageState)}.<br>` +
        `Background opacity ${Math.round(plan.background.opacity * 100)}%; ` +
        `frame ${Math.round(plan.background.transform.width)}x${Math.round(plan.background.transform.height)} at ` +
        `${Math.round(plan.background.transform.x)}, ${Math.round(plan.background.transform.y)}.<br>` +
        `${formatScaleDetail(plan.scale)}. Use Calibrate Scale for a reference line or Calibrate by Area with an active room.<br>` +
        `Baseboard candidates: ${formatBaseboardSummaryOverlay(baseboard, showBaseboardOverlay)}.<br>` +
        `Selected kind: ${formatSelectedRectangleKindOverlay(selectedRectangle)}.<br>` +
        `Selected room tag: ${formatSelectedRectangleRoomTagOverlay(selectedRectangle, plan)}.<br>` +
        `Selected dimensions: ${formatSelectedRectangleDimensionsOverlay(selectedRectangle, plan.scale)}.<br>` +
        `Selected wall cm: ${formatSelectedRectangleWallCmOverlay(selectedRectangle)}.<br>` +
        `Validation: ${formatValidationDetail(validation)}.<br>` +
        `Overlap flash: ${formatValidationOverlapFlashOverlay(validation, timestamp)}.<br>` +
        `File I/O: ${formatFileTransferStatusDetail(fileTransferStatus)}.<br>` +
        `Merge tool: select touching room rectangles, then Complete Merge. Merged room drag moves as one group; internal seams lock unless Internal Slides is enabled.<br>` +
        `Drag/resize snaps within ${SNAP_TOLERANCE_PX}px. Delete uses toolbar button or Delete/Backspace.<br>` +
        `Autosave/load still active: ${describeLoadSource(persistenceStatus.loadSource)}; ${formatAutosaveStatusDetail(persistenceStatus)}.`;
    }
  }

  function getBasicValidationResult(plan) {
    if (plan === lastValidatedPlan && lastValidationResult) {
      return lastValidationResult;
    }
    lastValidatedPlan = plan;
    lastValidationResult = validateBasicPlanGeometry(plan);
    return lastValidationResult;
  }

  function getBaseboardResult(plan) {
    if (plan === lastBaseboardPlan && lastBaseboardResult) {
      return lastBaseboardResult;
    }
    lastBaseboardPlan = plan;
    lastBaseboardResult = deriveBaseboardCandidates(plan);
    return lastBaseboardResult;
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
    }
    if (controls.toolCalibrateScaleButton) {
      controls.toolCalibrateScaleButton.setAttribute("aria-pressed", state.tool === "calibrateScale" ? "true" : "false");
    }
    if (controls.toolMergeRoomButton) {
      controls.toolMergeRoomButton.setAttribute("aria-pressed", state.tool === "mergeRoom" ? "true" : "false");
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
    if (controls.deleteSelectedButton) {
      controls.deleteSelectedButton.disabled = state.selection.rectangleId == null;
    }
    if (controls.rectangleKindToggleButton) {
      const selectedRectangle = getSelectedRectangle(snapshot.plan, state);
      const isWallRect = selectedRectangle?.kind === "wallRect";
      controls.rectangleKindToggleButton.disabled = !selectedRectangle;
      controls.rectangleKindToggleButton.setAttribute("aria-pressed", isWallRect ? "true" : "false");
      controls.rectangleKindToggleButton.textContent = selectedRectangle
        ? (isWallRect ? "Set As Room" : "Set As Wall")
        : "Set As Wall";
    }
    syncWallControls(snapshot.plan, state);
    syncRoomControls(snapshot.plan, state);
    syncMergeControls(snapshot.plan, state);
    syncAreaScaleCalibrationControl(snapshot.plan, state);
    if (controls.backgroundStatusElement) {
      controls.backgroundStatusElement.textContent = formatBackgroundShort(snapshot.plan.background, backgroundImageState);
    }
    if (controls.scaleStatusElement) {
      controls.scaleStatusElement.textContent = formatScaleToolbarStatus(snapshot.plan.scale);
    }
    syncRoomsSidebar(snapshot.plan, state, getBaseboardResult(snapshot.plan));
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
      const json = JSON.stringify(plan, null, 2);
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
    if (controls.importJsonFileInput) {
      controls.importJsonFileInput.removeEventListener("change", onImportJsonFileChange);
    }
  }

  function deleteSelectedRectangle() {
    const state = store.getState();
    const selectedRectangleId = state.editorState.selection.rectangleId;
    if (!selectedRectangleId) {
      return false;
    }

    store.dispatch({
      type: "plan/rectangles/delete",
      rectangleId: selectedRectangleId
    });
    store.dispatch({ type: "editor/selection/clear" });
    store.dispatch({ type: "editor/interaction/end", pointerId: null });
    syncEditorChrome();
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
    const wallEditingEnabled = hasSelection && selectedRectangle.kind !== "wallRect";

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
    const normalizedUpdates = normalizeRectangleGeometryUpdates(plan.entities.rectangles, rectangleUpdates);
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
    const selectedRectangle = getSelectedRectangle(plan, editorState);
    const selectedRoom = getRoomForRectangle(plan, selectedRectangle);

    if (controls.mergeStatusElement) {
      if (mergeState.selectedCount > 0 || mergeState.hasInvalidSelection) {
        controls.mergeStatusElement.textContent = `${mergeState.selectedCount} selected (${mergeState.statusLabel})`;
      } else if (mergeMode) {
        controls.mergeStatusElement.textContent = "Select touching room rectangles";
      } else {
        controls.mergeStatusElement.textContent = "Use Merge Room tool to select rectangles";
      }
    }

    if (controls.roomMergeCompleteButton) {
      controls.roomMergeCompleteButton.disabled = !mergeState.canComplete;
    }

    if (controls.roomMergeCancelButton) {
      controls.roomMergeCancelButton.disabled = !(mergeMode || mergeState.selectedCount > 0);
    }

    if (controls.roomDissolveButton) {
      controls.roomDissolveButton.disabled = !selectedRoom;
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
    const { roomListElement, roomSummaryElement, roomTotalsElement, roomDetailsElement } = controls;
    if (!roomListElement && !roomSummaryElement && !roomTotalsElement && !roomDetailsElement) {
      return;
    }

    const roomEntries = deriveSidebarRooms(plan);
    const effectiveActiveRoomId = deriveEffectiveActiveRoomId(plan, editorState, roomEntries);
    const metersPerWorldUnit = plan.scale?.metersPerWorldUnit;
    const totalMetrics = computeRoomsAggregateMetrics(roomEntries, plan, baseboard, metersPerWorldUnit);

    if (roomSummaryElement) {
      const roomCountLabel = `${roomEntries.length} room${roomEntries.length === 1 ? "" : "s"}`;
      roomSummaryElement.textContent = roomEntries.length === 0
        ? "No rooms tagged yet."
        : `${roomCountLabel} • click to activate • double-click to center`;
    }

    if (roomTotalsElement) {
      roomTotalsElement.textContent =
        `Total: area ${totalMetrics.areaLabel} • baseboard ${totalMetrics.baseboardLabel}`;
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
          const item = document.createElement("button");
          item.type = "button";
          item.className = "room-list-item";
          if (roomEntry.id === effectiveActiveRoomId) {
            item.classList.add("active");
          }
          item.dataset.roomItemId = roomEntry.id;

          const swatch = document.createElement("span");
          swatch.className = "room-list-swatch";
          swatch.style.background = roomColor(roomEntry.id, 0.9);

          const name = document.createElement("span");
          name.className = "room-list-name";
          name.textContent = roomEntry.name;

          const meta = document.createElement("span");
          meta.className = "room-list-meta";
          meta.textContent = `${roomEntry.rectangleIds.length} rect`;
          if (roomEntry.rectangleIds.length !== 1) {
            meta.textContent += "s";
          }

          item.append(swatch, name, meta);
          roomListElement.append(item);
        }
      }
    }

    if (roomDetailsElement) {
      const activeRoom = roomEntries.find((entry) => entry.id === effectiveActiveRoomId) ?? null;
      if (!activeRoom) {
        roomDetailsElement.innerHTML = "Select a room to view its area and baseboard totals.";
      } else {
        const metrics = computeRoomMetrics(activeRoom, plan, baseboard, metersPerWorldUnit);
        const displayId = activeRoom.roomId ?? activeRoom.rectangleIds[0] ?? activeRoom.id;
        const displayType = activeRoom.roomId
          ? formatRoomTypeLabel(activeRoom.roomType)
          : "unassigned";
        roomDetailsElement.innerHTML =
          `<strong>${escapeHtmlForOverlay(activeRoom.name)}</strong><br>` +
          `ID: ${escapeHtmlForOverlay(displayId)}<br>` +
          `Type: ${escapeHtmlForOverlay(displayType)}<br>` +
          `Rectangles: ${activeRoom.rectangleIds.length}<br>` +
          `Area: ${escapeHtmlForOverlay(metrics.areaLabel)}<br>` +
          `Baseboard: ${escapeHtmlForOverlay(metrics.baseboardLabel)}<br>` +
          `Color: <span style="display:inline-block;width:10px;height:10px;border-radius:3px;background:${roomColor(activeRoom.id, 0.9)};"></span>`;
      }
    }
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

  const segments = Array.isArray(baseboard?.segments) ? baseboard.segments : [];
  let baseboardWorld = 0;
  const roomRectangleIdSet = new Set(roomEntry.rectangleIds);
  for (const segment of segments) {
    if (roomEntry.roomId) {
      if (segment?.roomId !== roomEntry.roomId) {
        continue;
      }
    } else {
      if (!roomRectangleIdSet.has(segment?.rectangleId) || segment?.roomId != null) {
        continue;
      }
    }
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

function computeRoomsAggregateMetrics(roomEntries, plan, baseboard, metersPerWorldUnit) {
  const entries = Array.isArray(roomEntries) ? roomEntries : [];
  let areaWorld = 0;
  let baseboardWorld = 0;
  for (const roomEntry of entries) {
    const metrics = computeRoomMetrics(roomEntry, plan, baseboard, metersPerWorldUnit);
    areaWorld += metrics.areaWorld;
    baseboardWorld += metrics.baseboardWorld;
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
  if (!baseboard || baseboard.segmentCount === 0) {
    return `0 segments (${visibility})`;
  }
  return `${baseboard.segmentCount} segments, ${formatBaseboardLength(baseboard)} (${visibility})`;
}

function formatBaseboardSummaryStatus(baseboard, showOverlay) {
  const visibility = showOverlay ? "bb:on" : "bb:off";
  if (!baseboard || baseboard.segmentCount === 0) {
    return `${visibility} seg:0`;
  }
  return `${visibility} seg:${baseboard.segmentCount} len:${formatBaseboardLength(baseboard)}`;
}

function formatBaseboardSummaryOverlay(baseboard, showOverlay) {
  const visibility = showOverlay ? "visible" : "hidden";
  if (!baseboard || baseboard.segmentCount === 0) {
    return `0 segments (${visibility})`;
  }
  return `${baseboard.segmentCount} segments totaling ${formatBaseboardLength(baseboard)} (${visibility})`;
}

function formatBaseboardLength(baseboard) {
  if (!baseboard) {
    return "0.0wu";
  }
  if (Number.isFinite(baseboard.totalLengthMeters)) {
    return `${baseboard.totalLengthMeters.toFixed(2)}m`;
  }
  if (Number.isFinite(baseboard.totalLengthWorld)) {
    return `${baseboard.totalLengthWorld.toFixed(1)}wu`;
  }
  return "n/a";
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

function normalizeRectangleGeometryUpdates(rectangles, updates) {
  if (!Array.isArray(rectangles) || !Array.isArray(updates) || updates.length === 0) {
    return [];
  }
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
    normalized.push({
      id: rectangleId,
      x: update.x,
      y: update.y,
      w: update.w,
      h: update.h
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

function isBaseboardOverlayEnabled(editorState) {
  return Boolean(editorState?.debug?.showBaseboardOverlay);
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
    const stroke = isWall ? "#222" : (roomStroke ?? "#0b6e4f");
    const fill = isWall
      ? "rgba(20,20,20,0.20)"
      : (roomFill ?? "rgba(11,110,79,0.14)");
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
      ctx.fillStyle = "rgba(15, 42, 34, 0.22)";
      for (const band of Object.values(wallBands)) {
        if (!band) {
          continue;
        }
        ctx.fillRect(band.x, band.y, band.w, band.h);
      }
      ctx.strokeStyle = "rgba(15, 42, 34, 0.45)";
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
  if (!baseboard || !Array.isArray(baseboard.segments) || baseboard.segments.length === 0) {
    return;
  }

  ctx.save();
  ctx.strokeStyle = "rgba(212, 30, 30, 0.95)";
  ctx.lineWidth = 5 / camera.zoom;
  ctx.lineCap = "round";

  for (const segment of baseboard.segments) {
    ctx.beginPath();
    ctx.moveTo(segment.x0, segment.y0);
    ctx.lineTo(segment.x1, segment.y1);
    ctx.stroke();
  }

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
