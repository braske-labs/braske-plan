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
  distanceBetweenWorldPoints,
  formatMetersAndCentimeters,
  worldLengthToMeters
} from "./geometry/scale.js";
import { snapDraggedRectangle, snapResizedRectangle } from "./geometry/snapping.js";
import { createPlanAutosaveController, loadPersistedPlan } from "./persistence/local-plan-storage.js";
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

    canvas.setPointerCapture(event.pointerId);

    if (event.button === 1) {
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

    if (selectedRectangle) {
      const handleHit = hitTestResizeHandles(selectedRectangle, worldPoint, editorState.camera.zoom, {
        handleSizePx: HANDLE_SIZE_PX
      });
      if (handleHit) {
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
          rectH: selectedRectangle.h
        });
        syncEditorChrome();
        return;
      }
    }

    const hit = hitTestRectangles(plan.entities.rectangles, worldPoint);
    if (hit) {
      const dragOffset = computeRectangleDragOffset(hit.rectangle, worldPoint);

      store.dispatch({
        type: "editor/selection/set",
        rectangleId: hit.rectangle.id
      });
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
      const proposedRectangle = draggedRectangle
        ? {
            x: nextPosition.x,
            y: nextPosition.y,
            w: draggedRectangle.w,
            h: draggedRectangle.h
          }
        : { x: nextPosition.x, y: nextPosition.y, w: 0, h: 0 };
      const snapResult = draggedRectangle
        ? snapDraggedRectangle(proposedRectangle, state.plan.entities.rectangles, {
            excludeRectangleId: dragRectangle.rectangleId,
            toleranceWorld: SNAP_TOLERANCE_PX / state.editorState.camera.zoom
          })
        : { rectangle: proposedRectangle };

      store.dispatch({
        type: "plan/rectangles/move",
        rectangleId: dragRectangle.rectangleId,
        x: snapResult.rectangle.x,
        y: snapResult.rectangle.y
      });
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
      const nextRect = resizeRectangleFromHandle(
        resizeState.snapshot,
        resizeState.handleName,
        worldPoint,
        { minSize: MIN_RECT_SIZE }
      );
      const snappedRect = snapResizedRectangle(
        nextRect,
        resizeState.handleName,
        state.plan.entities.rectangles,
        {
          excludeRectangleId: resizeState.rectangleId,
          toleranceWorld: SNAP_TOLERANCE_PX / state.editorState.camera.zoom,
          minSize: MIN_RECT_SIZE
        }
      ).rectangle;

      store.dispatch({
        type: "plan/rectangles/setGeometry",
        rectangleId: resizeState.rectangleId,
        x: snappedRect.x,
        y: snappedRect.y,
        w: snappedRect.w,
        h: snappedRect.h
      });
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

  if (controls.deleteSelectedButton) {
    controls.deleteSelectedButton.addEventListener("click", () => {
      deleteSelectedRectangle();
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

    ensureBackgroundImageLoaded(plan.background);

    context.setTransform(dpr, 0, 0, dpr, 0, 0);
    context.clearRect(0, 0, cssWidth, cssHeight);
    context.fillStyle = "#ffffff";
    context.fillRect(0, 0, cssWidth, cssHeight);

    drawWorld(context, plan, editorState, cssWidth, cssHeight, dpr);
    drawScreenOverlay(context, editorState, plan, pointerHover, cssWidth, cssHeight);
    updateUiReadouts(editorState, plan, timestamp);
  }

  function drawWorld(ctx, plan, editorState, cssWidth, cssHeight, dpr) {
    const { camera, selection } = editorState;
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
    drawDebugRectangles(ctx, plan, selection.rectangleId, camera);
    drawSelectedResizeHandles(ctx, plan, editorState);
    drawDraftRectangle(ctx, editorState, camera);
    drawScaleReferenceLine(ctx, plan, camera);
    drawCalibrationDraftLine(ctx, editorState, camera);
    drawWorldAxes(ctx, camera, cssWidth, cssHeight);

    ctx.restore();
  }

  function drawScreenOverlay(ctx, editorState, plan, hover, cssWidth, cssHeight) {
    const { camera } = editorState;
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
    ctx.fillRect(12, 12, 470, 122);
    ctx.strokeRect(12, 12, 470, 122);

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

  function updateUiReadouts(editorState, plan, timestamp) {
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
      const selectedId = editorState.selection.rectangleId ?? "none";
      const tool = editorState.tool;
      const autosaveLabel = formatAutosaveStatusShort(persistenceStatus);
      const backgroundLabel = formatBackgroundShort(plan.background, backgroundImageState);
      const scaleLabel = formatScaleShort(plan.scale);
      const selectedDimsLabel = formatSelectedRectangleDimensionsStatus(getSelectedRectangle(plan, editorState), plan.scale);
      statusElement.textContent =
        `T-0015 canvas labels | ${backgroundLabel} | ${scaleLabel} | ${autosaveLabel} | tool ${tool} | pan | wheel zoom | ` +
        `camera ${camera.x.toFixed(1)}, ${camera.y.toFixed(1)} | ` +
        `zoom ${camera.zoom.toFixed(2)}x | ` +
        `rects ${plan.entities.rectangles.length} | selected ${selectedId}${selectedDimsLabel ? ` (${selectedDimsLabel})` : ""} | ` +
        `fps ~${fps.toFixed(0)}`;
    }

    if (overlayElement) {
      const selectedRectangle = getSelectedRectangle(plan, editorState);
      overlayElement.innerHTML =
        `T-0015 active (on-canvas selected-rectangle dimension labels + readouts). Image: ${formatBackgroundImageStatus(backgroundImageState)}.<br>` +
        `Background opacity ${Math.round(plan.background.opacity * 100)}%; ` +
        `frame ${Math.round(plan.background.transform.width)}x${Math.round(plan.background.transform.height)} at ` +
        `${Math.round(plan.background.transform.x)}, ${Math.round(plan.background.transform.y)}.<br>` +
        `${formatScaleDetail(plan.scale)}. Use Calibrate Scale tool to draw a reference line and enter meters.<br>` +
        `Selected dimensions: ${formatSelectedRectangleDimensionsOverlay(selectedRectangle, plan.scale)}.<br>` +
        `Drag/resize snaps within ${SNAP_TOLERANCE_PX}px. Delete uses toolbar button or Delete/Backspace.<br>` +
        `Autosave/load still active: ${describeLoadSource(persistenceStatus.loadSource)}; ${formatAutosaveStatusDetail(persistenceStatus)}.`;
    }
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
    if (controls.deleteSelectedButton) {
      controls.deleteSelectedButton.disabled = state.selection.rectangleId == null;
    }
    if (controls.backgroundStatusElement) {
      controls.backgroundStatusElement.textContent = formatBackgroundShort(snapshot.plan.background, backgroundImageState);
    }
    if (controls.scaleStatusElement) {
      controls.scaleStatusElement.textContent = formatScaleToolbarStatus(snapshot.plan.scale);
    }
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
  const refLabel = Number.isFinite(meters) ? `${meters}m ref` : "ref set";
  return `Scale ${metersPerWorldUnit.toFixed(4)} m/u (${refLabel})`;
}

function formatScaleDetail(scale) {
  const metersPerWorldUnit = scale?.metersPerWorldUnit;
  const referenceLine = scale?.referenceLine;
  if (!Number.isFinite(metersPerWorldUnit) || !referenceLine) {
    return "Scale not calibrated yet";
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
  const reservedRects = [{ x: 12, y: 12, w: 470, h: 122 }];
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

function drawDebugRectangles(ctx, plan, selectedRectangleId, camera) {
  for (const rect of plan.entities.rectangles) {
    const isWall = rect.kind === "wallRect";
    const stroke = isWall ? "#222" : "#0b6e4f";
    const fill = isWall ? "rgba(20,20,20,0.20)" : "rgba(11,110,79,0.14)";
    const isSelected = rect.id === selectedRectangleId;

    ctx.save();
    ctx.fillStyle = fill;
    ctx.strokeStyle = stroke;
    ctx.lineWidth = isWall ? 2 : 1.5;
    ctx.fillRect(rect.x, rect.y, rect.w, rect.h);
    ctx.strokeRect(rect.x, rect.y, rect.w, rect.h);

    if (rect.label) {
      ctx.fillStyle = "rgba(31,31,31,0.9)";
      ctx.font = "12px Georgia, serif";
      ctx.textBaseline = "top";
      ctx.fillText(rect.label, rect.x + 6, rect.y + 6);
    }

    if (isSelected) {
      ctx.strokeStyle = "rgba(35, 85, 235, 0.95)";
      ctx.lineWidth = 2.5 / camera.zoom;
      ctx.strokeRect(rect.x, rect.y, rect.w, rect.h);
    }

    ctx.restore();
  }
}

function drawSelectedResizeHandles(ctx, plan, editorState) {
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

  for (const handle of handles) {
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
