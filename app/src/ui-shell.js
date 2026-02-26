import { mountEditorRuntime } from "./editor/runtime.js";

export function createEditorShell(root) {
  if (root.__editorRuntime && typeof root.__editorRuntime.destroy === "function") {
    root.__editorRuntime.destroy();
  }

  root.replaceChildren(buildShell());

  const canvas = root.querySelector("#editorCanvas");
  const statusElement = root.querySelector("[data-editor-status]");
  const overlayElement = root.querySelector("[data-editor-overlay]");
  const shellElement = root.querySelector(".canvas-shell");
  const resetViewButton = root.querySelector("[data-editor-action='camera-reset']");
  const resetPlanButton = root.querySelector("[data-editor-action='plan-reset']");
  const seedDebugButton = root.querySelector("[data-editor-action='plan-seed-debug']");
  const toolNavigateButton = root.querySelector("[data-editor-action='tool-navigate']");
  const toolDrawRectButton = root.querySelector("[data-editor-action='tool-draw-rect']");
  const backgroundOpacityDownButton = root.querySelector("[data-editor-action='bg-opacity-down']");
  const backgroundOpacityUpButton = root.querySelector("[data-editor-action='bg-opacity-up']");
  const backgroundMoveLeftButton = root.querySelector("[data-editor-action='bg-move-left']");
  const backgroundMoveRightButton = root.querySelector("[data-editor-action='bg-move-right']");
  const backgroundMoveUpButton = root.querySelector("[data-editor-action='bg-move-up']");
  const backgroundMoveDownButton = root.querySelector("[data-editor-action='bg-move-down']");
  const backgroundScaleDownButton = root.querySelector("[data-editor-action='bg-scale-down']");
  const backgroundScaleUpButton = root.querySelector("[data-editor-action='bg-scale-up']");
  const backgroundStatusElement = root.querySelector("[data-background-status]");

  if (!canvas || !shellElement) return;

  root.__editorRuntime = mountEditorRuntime({
    canvas,
    statusElement,
    overlayElement,
    shellElement,
    controls: {
      resetViewButton,
      resetPlanButton,
      seedDebugButton,
      toolNavigateButton,
      toolDrawRectButton,
      backgroundOpacityDownButton,
      backgroundOpacityUpButton,
      backgroundMoveLeftButton,
      backgroundMoveRightButton,
      backgroundMoveUpButton,
      backgroundMoveDownButton,
      backgroundScaleDownButton,
      backgroundScaleUpButton,
      backgroundStatusElement
    }
  });
}

function buildShell() {
  const wrapper = document.createElement("div");
  wrapper.className = "shell";

  wrapper.innerHTML = `
    <aside class="panel sidebar" aria-label="Project info">
      <div>
        <h1>Apartment Planner MVP</h1>
      </div>
      <p>
        T-0007 adds a real background image overlay with simple opacity/position/scale controls for tracing.
      </p>
      <div class="meta-row" aria-label="Sprint metadata">
        <div class="pill">
          <strong>Current Sprint</strong>
          S002
        </div>
        <div class="pill">
          <strong>Ticket</strong>
          T-0007
        </div>
      </div>
      <ol class="checklist" aria-label="Immediate next steps">
        <li>This ticket: render and adjust the plan background image for tracing.</li>
        <li>Keep rectangle tools stable (draw/select/drag/resize/pan/zoom).</li>
        <li>Next: basic snapping and delete-selected rectangle.</li>
      </ol>
    </aside>
    <section class="panel editor-frame" aria-label="Editor">
      <div class="toolbar" role="toolbar" aria-label="Editor toolbar">
        <button type="button" data-editor-action="tool-navigate" aria-pressed="true">Navigate</button>
        <button type="button" data-editor-action="tool-draw-rect" aria-pressed="false">Draw Rect</button>
        <details class="toolbar-disclosure bg-controls">
          <summary>
            <span class="toolbar-label">BG Controls</span>
            <span class="toolbar-inline-status" data-background-status>BG pending...</span>
          </summary>
          <div class="toolbar-disclosure-panel">
            <button type="button" data-editor-action="bg-opacity-down">Opacity -</button>
            <button type="button" data-editor-action="bg-opacity-up">Opacity +</button>
            <button type="button" data-editor-action="bg-move-left">Left</button>
            <button type="button" data-editor-action="bg-move-right">Right</button>
            <button type="button" data-editor-action="bg-move-up">Up</button>
            <button type="button" data-editor-action="bg-move-down">Down</button>
            <button type="button" data-editor-action="bg-scale-down">Scale -</button>
            <button type="button" data-editor-action="bg-scale-up">Scale +</button>
          </div>
        </details>
        <button type="button" class="primary" data-editor-action="plan-reset">New Empty Plan</button>
        <button type="button" data-editor-action="plan-seed-debug">Seed Debug Rects</button>
        <button type="button" data-editor-action="camera-reset">Reset View</button>
        <span class="status" data-editor-status>Initializing editor runtime...</span>
      </div>
      <div class="canvas-shell" data-pan-mode="idle" data-tool-mode="navigate">
        <canvas id="editorCanvas" aria-label="Editor canvas"></canvas>
        <div class="canvas-overlay" data-editor-overlay>
          Runtime foundation loading...
        </div>
      </div>
    </section>
  `;

  return wrapper;
}
