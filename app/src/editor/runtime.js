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

      store.dispatch({
        type: "plan/rectangles/move",
        rectangleId: dragRectangle.rectangleId,
        x: nextPosition.x,
        y: nextPosition.y
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

      store.dispatch({
        type: "plan/rectangles/setGeometry",
        rectangleId: resizeState.rectangleId,
        x: nextRect.x,
        y: nextRect.y,
        w: nextRect.w,
        h: nextRect.h
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
    drawWorldAxes(ctx, camera, cssWidth, cssHeight);

    ctx.restore();
  }

  function drawScreenOverlay(ctx, editorState, plan, hover, cssWidth, cssHeight) {
    const { camera } = editorState;
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
    ctx.fillRect(12, 12, 320, 104);
    ctx.strokeRect(12, 12, 320, 104);

    ctx.fillStyle = "#1f1f1f";
    ctx.font = "12px Georgia, serif";
    ctx.textBaseline = "top";
    ctx.fillText(`Zoom: ${camera.zoom.toFixed(2)}x`, 20, 18);
    ctx.fillText(`Camera: ${camera.x.toFixed(1)}, ${camera.y.toFixed(1)}`, 20, 34);
    ctx.fillText(`Rects: ${plan.entities.rectangles.length}`, 20, 50);
    ctx.fillText(`Selected: ${editorState.selection.rectangleId ?? "none"}`, 20, 66);
    ctx.fillText(`Tool: ${editorState.tool}`, 20, 82);
    ctx.fillText(`Mode: ${editorState.interaction.mode}`, 20, 98);
    ctx.restore();

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
      statusElement.textContent =
        `T-0007 background | ${backgroundLabel} | ${autosaveLabel} | tool ${tool} | drag rect move | drag empty pan | wheel zoom | ` +
        `camera ${camera.x.toFixed(1)}, ${camera.y.toFixed(1)} | ` +
        `zoom ${camera.zoom.toFixed(2)}x | ` +
        `rects ${plan.entities.rectangles.length} | selected ${selectedId} | ` +
        `fps ~${fps.toFixed(0)}`;
    }

    if (overlayElement) {
      overlayElement.innerHTML =
        `T-0007 active (background controls). Image: ${formatBackgroundImageStatus(backgroundImageState)}.<br>` +
        `Background opacity ${Math.round(plan.background.opacity * 100)}%; ` +
        `frame ${Math.round(plan.background.transform.width)}x${Math.round(plan.background.transform.height)} at ` +
        `${Math.round(plan.background.transform.x)}, ${Math.round(plan.background.transform.y)}.<br>` +
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
    if (controls.backgroundStatusElement) {
      controls.backgroundStatusElement.textContent = formatBackgroundShort(snapshot.plan.background, backgroundImageState);
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
    canvas.removeEventListener("pointerdown", onPointerDown);
    canvas.removeEventListener("pointermove", onPointerMove);
    canvas.removeEventListener("pointerup", onPointerUp);
    canvas.removeEventListener("pointercancel", onPointerCancel);
    canvas.removeEventListener("pointerleave", onPointerLeave);
    canvas.removeEventListener("wheel", onWheel);
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
