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
  const toolCalibrateScaleButton = root.querySelector("[data-editor-action='tool-calibrate-scale']");
  const deleteSelectedButton = root.querySelector("[data-editor-action='rect-delete']");
  const wallStatusElement = root.querySelector("[data-wall-status]");
  const wallTopValueElement = root.querySelector("[data-wall-value='top']");
  const wallRightValueElement = root.querySelector("[data-wall-value='right']");
  const wallBottomValueElement = root.querySelector("[data-wall-value='bottom']");
  const wallLeftValueElement = root.querySelector("[data-wall-value='left']");
  const wallTopDecreaseButton = root.querySelector("[data-editor-action='wall-top-dec']");
  const wallTopIncreaseButton = root.querySelector("[data-editor-action='wall-top-inc']");
  const wallRightDecreaseButton = root.querySelector("[data-editor-action='wall-right-dec']");
  const wallRightIncreaseButton = root.querySelector("[data-editor-action='wall-right-inc']");
  const wallBottomDecreaseButton = root.querySelector("[data-editor-action='wall-bottom-dec']");
  const wallBottomIncreaseButton = root.querySelector("[data-editor-action='wall-bottom-inc']");
  const wallLeftDecreaseButton = root.querySelector("[data-editor-action='wall-left-dec']");
  const wallLeftIncreaseButton = root.querySelector("[data-editor-action='wall-left-inc']");
  const exportJsonButton = root.querySelector("[data-editor-action='plan-export-json']");
  const importJsonButton = root.querySelector("[data-editor-action='plan-import-json']");
  const importJsonFileInput = root.querySelector("[data-editor-file-input='plan-import']");
  const backgroundOpacityDownButton = root.querySelector("[data-editor-action='bg-opacity-down']");
  const backgroundOpacityUpButton = root.querySelector("[data-editor-action='bg-opacity-up']");
  const backgroundMoveLeftButton = root.querySelector("[data-editor-action='bg-move-left']");
  const backgroundMoveRightButton = root.querySelector("[data-editor-action='bg-move-right']");
  const backgroundMoveUpButton = root.querySelector("[data-editor-action='bg-move-up']");
  const backgroundMoveDownButton = root.querySelector("[data-editor-action='bg-move-down']");
  const backgroundScaleDownButton = root.querySelector("[data-editor-action='bg-scale-down']");
  const backgroundScaleUpButton = root.querySelector("[data-editor-action='bg-scale-up']");
  const backgroundStatusElement = root.querySelector("[data-background-status]");
  const scaleStatusElement = root.querySelector("[data-scale-status]");

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
      toolCalibrateScaleButton,
      deleteSelectedButton,
      wallStatusElement,
      wallTopValueElement,
      wallRightValueElement,
      wallBottomValueElement,
      wallLeftValueElement,
      wallTopDecreaseButton,
      wallTopIncreaseButton,
      wallRightDecreaseButton,
      wallRightIncreaseButton,
      wallBottomDecreaseButton,
      wallBottomIncreaseButton,
      wallLeftDecreaseButton,
      wallLeftIncreaseButton,
      exportJsonButton,
      importJsonButton,
      importJsonFileInput,
      backgroundOpacityDownButton,
      backgroundOpacityUpButton,
      backgroundMoveLeftButton,
      backgroundMoveRightButton,
      backgroundMoveUpButton,
      backgroundMoveDownButton,
      backgroundScaleDownButton,
      backgroundScaleUpButton,
      backgroundStatusElement,
      scaleStatusElement
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
        T-0018 adds per-side wall thickness editing controls on the selected rectangle (top/right/bottom/left).
      </p>
      <div class="meta-row" aria-label="Sprint metadata">
        <div class="pill">
          <strong>Current Sprint</strong>
          S005
        </div>
        <div class="pill">
          <strong>Ticket</strong>
          T-0018
        </div>
      </div>
      <ol class="checklist" aria-label="Immediate next steps">
        <li>This ticket: edit wall thickness for selected rectangle sides independently.</li>
        <li>Persist wallCm values in plan state without disrupting drawing interactions.</li>
        <li>Next: derive perimeter segments from authored geometry.</li>
      </ol>
    </aside>
    <section class="panel editor-frame" aria-label="Editor">
      <div class="toolbar" role="toolbar" aria-label="Editor toolbar">
        <button type="button" data-editor-action="tool-navigate" aria-pressed="true">Navigate</button>
        <button type="button" data-editor-action="tool-draw-rect" aria-pressed="false">Draw Rect</button>
        <button type="button" data-editor-action="tool-calibrate-scale" aria-pressed="false">Calibrate Scale</button>
        <button type="button" data-editor-action="rect-delete" disabled>Delete Rect</button>
        <details class="toolbar-disclosure wall-controls" open>
          <summary>
            <span class="toolbar-disclosure-title">Wall Cm</span>
            <span class="toolbar-inline-status" data-wall-status>No selection</span>
          </summary>
          <div class="toolbar-disclosure-panel wall-controls-panel">
            <div class="wall-row">
              <span class="wall-side">Top</span>
              <button type="button" data-editor-action="wall-top-dec">-</button>
              <span class="wall-value" data-wall-value="top">-</span>
              <button type="button" data-editor-action="wall-top-inc">+</button>
            </div>
            <div class="wall-row">
              <span class="wall-side">Right</span>
              <button type="button" data-editor-action="wall-right-dec">-</button>
              <span class="wall-value" data-wall-value="right">-</span>
              <button type="button" data-editor-action="wall-right-inc">+</button>
            </div>
            <div class="wall-row">
              <span class="wall-side">Bottom</span>
              <button type="button" data-editor-action="wall-bottom-dec">-</button>
              <span class="wall-value" data-wall-value="bottom">-</span>
              <button type="button" data-editor-action="wall-bottom-inc">+</button>
            </div>
            <div class="wall-row">
              <span class="wall-side">Left</span>
              <button type="button" data-editor-action="wall-left-dec">-</button>
              <span class="wall-value" data-wall-value="left">-</span>
              <button type="button" data-editor-action="wall-left-inc">+</button>
            </div>
          </div>
        </details>
        <button type="button" data-editor-action="plan-export-json">Export JSON</button>
        <button type="button" data-editor-action="plan-import-json">Import JSON</button>
        <input type="file" accept="application/json,.json" data-editor-file-input="plan-import" hidden>
        <span class="toolbar-inline-status" data-scale-status>Scale not calibrated</span>
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
