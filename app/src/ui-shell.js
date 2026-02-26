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
      toolDrawRectButton
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
        T-0003 adds autosave and reopen on top of the current rectangle editor so work survives close/reload.
      </p>
      <div class="meta-row" aria-label="Sprint metadata">
        <div class="pill">
          <strong>Current Sprint</strong>
          S001
        </div>
        <div class="pill">
          <strong>Ticket</strong>
          T-0003
        </div>
      </div>
      <ol class="checklist" aria-label="Immediate next steps">
        <li>This ticket: autosave plan edits and reload the last saved plan on startup.</li>
        <li>Keep rectangle tools stable (draw/select/drag/resize/pan/zoom).</li>
        <li>Next: background overlay controls and basic snapping.</li>
      </ol>
    </aside>
    <section class="panel editor-frame" aria-label="Editor">
      <div class="toolbar" role="toolbar" aria-label="Editor toolbar">
        <button type="button" data-editor-action="tool-navigate" aria-pressed="true">Navigate</button>
        <button type="button" data-editor-action="tool-draw-rect" aria-pressed="false">Draw Rect</button>
        <button type="button" class="primary" data-editor-action="plan-reset">New Empty Plan</button>
        <button type="button" data-editor-action="plan-seed-debug">Seed Debug Rects</button>
        <button type="button" data-editor-action="camera-reset">Reset View</button>
        <span class="status" data-editor-status>Initializing editor runtime…</span>
      </div>
      <div class="canvas-shell" data-pan-mode="idle" data-tool-mode="navigate">
        <canvas id="editorCanvas" aria-label="Editor canvas"></canvas>
        <div class="canvas-overlay" data-editor-overlay>
          Runtime foundation loading…
        </div>
      </div>
    </section>
  `;

  return wrapper;
}
