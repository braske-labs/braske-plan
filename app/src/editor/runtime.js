import { screenToWorld, worldToScreen } from "./geometry/coordinates.js";
import {
  computeRectangleDragOffset,
  computeRectanglePositionFromPointer,
  hitTestRectangles
} from "./geometry/rectangles.js";
import { createInitialEditorState } from "./state/editor-ui.js";
import { createEmptyPlan } from "./state/plan.js";
import { createEditorSessionStore } from "./state/session-store.js";

export function mountEditorRuntime(options) {
  const { canvas, statusElement, overlayElement, shellElement, controls = {} } = options;
  const context = canvas.getContext("2d");
  if (!context) {
    throw new Error("2D canvas context is required");
  }

  const store = createEditorSessionStore({
    plan: createEmptyPlan(),
    editorState: createInitialEditorState()
  });

  store.dispatch({ type: "plan/debugSeedRectangles" });

  let destroyed = false;
  let rafId = 0;
  let frameCount = 0;
  let lastFpsSampleMs = performance.now();
  let framesSinceSample = 0;
  let fps = 0;
  const pointerHover = { active: false, screenX: 0, screenY: 0 };

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
    const worldPoint = screenToWorld(state.editorState.camera, point.x, point.y);
    const hit = event.button === 0
      ? hitTestRectangles(state.plan.entities.rectangles, worldPoint)
      : null;

    canvas.setPointerCapture(event.pointerId);
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
    } else {
      if (event.button === 0) {
        store.dispatch({ type: "editor/selection/clear" });
      }
      store.dispatch({
        type: "editor/interaction/panStart",
        pointerId: event.pointerId,
        screenX: event.clientX,
        screenY: event.clientY
      });
    }
    syncPanCursor();
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
    }
  };

  const onPointerUp = (event) => {
    store.dispatch({
      type: "editor/interaction/end",
      pointerId: event.pointerId
    });
    syncPanCursor();
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

  store.subscribe(() => {
    syncPanCursor();
  });

  resize();
  syncPanCursor();
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

    drawGrid(ctx, camera, cssWidth, cssHeight);
    drawBackgroundFrame(ctx, plan);
    drawDebugRectangles(ctx, plan, selection.rectangleId, camera);
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
    ctx.fillRect(12, 12, 300, 88);
    ctx.strokeRect(12, 12, 300, 88);

    ctx.fillStyle = "#1f1f1f";
    ctx.font = "12px Georgia, serif";
    ctx.textBaseline = "top";
    ctx.fillText(`Zoom: ${camera.zoom.toFixed(2)}x`, 20, 18);
    ctx.fillText(`Camera: ${camera.x.toFixed(1)}, ${camera.y.toFixed(1)}`, 20, 34);
    ctx.fillText(`Rects: ${plan.entities.rectangles.length}`, 20, 50);
    ctx.fillText(`Selected: ${editorState.selection.rectangleId ?? "none"}`, 20, 66);
    ctx.fillText(`Mode: ${editorState.interaction.mode}`, 20, 82);
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
      statusElement.textContent =
        `T-0005 selection+drag | drag rect to move, drag empty to pan, wheel to zoom | ` +
        `camera ${camera.x.toFixed(1)}, ${camera.y.toFixed(1)} | ` +
        `zoom ${camera.zoom.toFixed(2)}x | ` +
        `rects ${plan.entities.rectangles.length} | selected ${selectedId} | ` +
        `fps ~${fps.toFixed(0)}`;
    }

    if (overlayElement) {
      overlayElement.innerHTML =
        `T-0005 active.<br>` +
        `Click rectangle to select, then drag to move. Drag empty canvas to pan.<br>` +
        `Wheel zoom stays cursor-anchored. Buttons still dispatch reducer actions.`;
    }
  }

  function syncPanCursor() {
    const mode = store.getState().editorState.interaction.mode;
    if (shellElement) {
      shellElement.dataset.panMode = mode;
    }
  }

  function destroy() {
    destroyed = true;
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

function drawBackgroundFrame(ctx, plan) {
  const background = plan.background;
  if (!background?.transform) return;

  const { x, y, width, height } = background.transform;
  ctx.save();
  ctx.fillStyle = "rgba(11, 110, 79, 0.03)";
  ctx.strokeStyle = "rgba(11, 110, 79, 0.25)";
  ctx.lineWidth = 1.2;
  ctx.setLineDash([10, 8]);
  ctx.fillRect(x, y, width, height);
  ctx.strokeRect(x, y, width, height);
  ctx.setLineDash([]);
  ctx.restore();
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
