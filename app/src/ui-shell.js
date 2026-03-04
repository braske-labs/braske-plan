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
  const calibrateScaleByAreaButton = root.querySelector("[data-editor-action='scale-calibrate-area']");
  const toolMergeRoomButton = root.querySelector("[data-editor-action='tool-merge-room']");
  const geometryFreezeToggleButton = root.querySelector("[data-editor-action='geometry-freeze-toggle']");
  const normalizeCmGridButton = root.querySelector("[data-editor-action='rect-normalize-cm']");
  const toolPlaceSwitchButton = root.querySelector("[data-editor-action='tool-place-switch']");
  const toolPlaceLampButton = root.querySelector("[data-editor-action='tool-place-lamp']");
  const toolPlaceDoorButton = root.querySelector("[data-editor-action='tool-place-door']");
  const toolPlaceWindowButton = root.querySelector("[data-editor-action='tool-place-window']");
  const toolLinkLightingButton = root.querySelector("[data-editor-action='tool-link-lighting']");
  const estimateToggleButton = root.querySelector("[data-editor-action='estimate-toggle']");
  const estimateGroupModeToggleButton = root.querySelector("[data-editor-action='estimate-group-mode-toggle']");
  const roomHighlightToggleButton = root.querySelector("[data-editor-action='view-room-highlighting-toggle']");
  const wallsBlackToggleButton = root.querySelector("[data-editor-action='view-walls-black-toggle']");
  const estimatePrintButton = root.querySelector("[data-editor-action='estimate-print']");
  const deleteSelectedButton = root.querySelector("[data-editor-action='rect-delete']");
  const deleteSelectedOpeningButton = root.querySelector("[data-editor-action='opening-delete']");
  const deleteSelectedFixtureButton = root.querySelector("[data-editor-action='lighting-delete-fixture']");
  const unplugSelectedFixtureButton = root.querySelector("[data-editor-action='lighting-unplug-selected']");
  const clearLightingLinkSourceButton = root.querySelector("[data-editor-action='lighting-clear-link-source']");
  const rectangleKindToggleButton = root.querySelector("[data-editor-action='rect-toggle-kind']");
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
  const roomStatusElement = root.querySelector("[data-room-status]");
  const roomNameInput = root.querySelector("[data-room-input='name']");
  const roomTypeSelect = root.querySelector("[data-room-input='type']");
  const roomAssignButton = root.querySelector("[data-editor-action='room-assign']");
  const roomClearButton = root.querySelector("[data-editor-action='room-clear']");
  const mergeStatusElement = root.querySelector("[data-merge-status]");
  const lightingStatusElement = root.querySelector("[data-lighting-status]");
  const openingStatusElement = root.querySelector("[data-opening-status]");
  const paintingStatusElement = root.querySelector("[data-painting-status]");
  const lightingProductSelect = root.querySelector("[data-editor-input='lighting-product-id']");
  const openingDoorProductSelect = root.querySelector("[data-editor-input='opening-door-product-id']");
  const wallHeightInput = root.querySelector("[data-editor-input='wall-height-meters']");
  const wallHeightApplyButton = root.querySelector("[data-editor-action='wall-height-apply']");
  const roomMergeCompleteButton = root.querySelector("[data-editor-action='room-merge-complete']");
  const roomMergeCancelButton = root.querySelector("[data-editor-action='room-merge-cancel']");
  const roomDissolveButton = root.querySelector("[data-editor-action='room-dissolve']");
  const roomInternalSlideToggleButton = root.querySelector("[data-editor-action='room-internal-slide-toggle']");
  const exportJsonButton = root.querySelector("[data-editor-action='plan-export-json']");
  const importJsonButton = root.querySelector("[data-editor-action='plan-import-json']");
  const importJsonFileInput = root.querySelector("[data-editor-file-input='plan-import']");
  const baseboardDebugToggleButton = root.querySelector("[data-editor-action='debug-baseboard-toggle']");
  const baseboardConflictToggleButton = root.querySelector("[data-editor-action='debug-baseboard-conflicts-toggle']");
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
  const roomListElement = root.querySelector("[data-room-list]");
  const roomSummaryElement = root.querySelector("[data-room-summary]");
  const roomTotalsElement = root.querySelector("[data-room-totals]");
  const estimatePanelElement = root.querySelector("[data-estimate-panel]");
  const estimateBodyElement = root.querySelector("[data-estimate-body]");

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
      calibrateScaleByAreaButton,
      toolMergeRoomButton,
      geometryFreezeToggleButton,
      normalizeCmGridButton,
      toolPlaceSwitchButton,
      toolPlaceLampButton,
      toolPlaceDoorButton,
      toolPlaceWindowButton,
      toolLinkLightingButton,
      estimateToggleButton,
      estimateGroupModeToggleButton,
      roomHighlightToggleButton,
      wallsBlackToggleButton,
      estimatePrintButton,
      deleteSelectedButton,
      deleteSelectedOpeningButton,
      deleteSelectedFixtureButton,
      unplugSelectedFixtureButton,
      clearLightingLinkSourceButton,
      rectangleKindToggleButton,
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
      roomStatusElement,
      roomNameInput,
      roomTypeSelect,
      roomAssignButton,
      roomClearButton,
      mergeStatusElement,
      lightingStatusElement,
      openingStatusElement,
      paintingStatusElement,
      lightingProductSelect,
      openingDoorProductSelect,
      wallHeightInput,
      wallHeightApplyButton,
      roomMergeCompleteButton,
      roomMergeCancelButton,
      roomDissolveButton,
      roomInternalSlideToggleButton,
      exportJsonButton,
      importJsonButton,
      importJsonFileInput,
      baseboardDebugToggleButton,
      baseboardConflictToggleButton,
      backgroundOpacityDownButton,
      backgroundOpacityUpButton,
      backgroundMoveLeftButton,
      backgroundMoveRightButton,
      backgroundMoveUpButton,
      backgroundMoveDownButton,
      backgroundScaleDownButton,
      backgroundScaleUpButton,
      backgroundStatusElement,
      scaleStatusElement,
      roomListElement,
      roomSummaryElement,
      roomTotalsElement,
      estimatePanelElement,
      estimateBodyElement
    }
  });
}

function buildShell() {
  const wrapper = document.createElement("div");
  wrapper.className = "shell";

  wrapper.innerHTML = `
    <aside class="panel sidebar rooms-sidebar" aria-label="Rooms">
      <div class="rooms-sidebar-header">
        <h1>Rooms</h1>
        <p data-room-summary>No rooms yet.</p>
        <p class="rooms-totals" data-room-totals>Total: area 0.0 wu² • baseboard 0.0 wu</p>
      </div>
      <div class="rooms-list" data-room-list>
        <div class="rooms-empty">Create or merge room rectangles to populate this list.</div>
      </div>
    </aside>
    <section class="panel editor-frame" aria-label="Editor">
      <div class="toolbar" role="toolbar" aria-label="Editor toolbar">
        <button type="button" data-editor-action="tool-navigate" aria-pressed="true">Navigate</button>
        <button type="button" data-editor-action="tool-draw-rect" aria-pressed="false">Draw Rect</button>
        <button type="button" data-editor-action="tool-calibrate-scale" aria-pressed="false">Calibrate Scale</button>
        <button type="button" data-editor-action="scale-calibrate-area" disabled>Calibrate by Area</button>
        <button type="button" data-editor-action="tool-merge-room" aria-pressed="false">Merge Room</button>
        <button type="button" data-editor-action="geometry-freeze-toggle" aria-pressed="false">Freeze Geometry: Off</button>
        <button type="button" data-editor-action="rect-normalize-cm" disabled>Normalize CM Grid</button>
        <button type="button" data-editor-action="tool-place-switch" aria-pressed="false">Place Switch</button>
        <button type="button" data-editor-action="tool-place-lamp" aria-pressed="false">Place Lamp</button>
        <button type="button" data-editor-action="tool-place-door" aria-pressed="false">Place Door</button>
        <button type="button" data-editor-action="tool-place-window" aria-pressed="false">Place Window</button>
        <button type="button" data-editor-action="tool-link-lighting" aria-pressed="false">Link Lights</button>
        <button type="button" data-editor-action="estimate-toggle" aria-pressed="false">Estimate: Off</button>
        <button type="button" data-editor-action="view-room-highlighting-toggle" aria-pressed="true">Room Highlighting: On</button>
        <button type="button" data-editor-action="view-walls-black-toggle" aria-pressed="false">Walls Black: Off</button>
        <button type="button" data-editor-action="rect-delete" disabled>Delete Rect</button>
        <button type="button" data-editor-action="opening-delete" disabled>Delete Opening</button>
        <button type="button" data-editor-action="rect-toggle-kind" aria-pressed="false" disabled>Set As Wall</button>
        <details class="toolbar-disclosure wall-controls">
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
        <details class="toolbar-disclosure room-controls">
          <summary>
            <span class="toolbar-disclosure-title">Room Tag</span>
            <span class="toolbar-inline-status" data-room-status>No selection</span>
          </summary>
          <div class="toolbar-disclosure-panel room-controls-panel">
            <label class="room-field">
              <span>Name</span>
              <input type="text" data-room-input="name" placeholder="Bathroom" maxlength="64">
            </label>
            <label class="room-field">
              <span>Type</span>
              <select data-room-input="type">
                <option value="generic">Generic</option>
                <option value="bathroom">Bathroom</option>
                <option value="toilet">Toilet</option>
                <option value="kitchen">Kitchen</option>
                <option value="living_room">Living Room</option>
                <option value="bedroom">Bedroom</option>
                <option value="hallway">Hallway</option>
                <option value="closet">Closet</option>
                <option value="storage">Storage</option>
                <option value="utility">Utility</option>
                <option value="other">Other</option>
              </select>
            </label>
            <button type="button" data-editor-action="room-assign">Save Room Tag</button>
            <button type="button" data-editor-action="room-clear">Clear Room Tag</button>
          </div>
        </details>
        <details class="toolbar-disclosure merge-controls">
          <summary>
            <span class="toolbar-disclosure-title">Merge Room</span>
            <span class="toolbar-inline-status" data-merge-status>Select at least 2 touching room rects</span>
          </summary>
          <div class="toolbar-disclosure-panel merge-controls-panel">
            <button type="button" data-editor-action="room-merge-complete" disabled>Complete Merge</button>
            <button type="button" data-editor-action="room-merge-cancel" disabled>Cancel Merge</button>
            <button type="button" data-editor-action="room-dissolve" disabled>Dissolve Room</button>
            <button type="button" data-editor-action="room-internal-slide-toggle" aria-pressed="false">Internal Slides: Off</button>
          </div>
        </details>
        <details class="toolbar-disclosure lighting-controls">
          <summary>
            <span class="toolbar-disclosure-title">Lighting</span>
            <span class="toolbar-inline-status" data-lighting-status>No fixture selected</span>
          </summary>
          <div class="toolbar-disclosure-panel merge-controls-panel">
            <button type="button" data-editor-action="lighting-unplug-selected" disabled>Unplug Selected</button>
            <button type="button" data-editor-action="lighting-delete-fixture" disabled>Delete Fixture</button>
            <button type="button" data-editor-action="lighting-clear-link-source" disabled>Clear Link Source</button>
            <label class="room-field">
              <span>Selected Fixture Product</span>
              <select data-editor-input="lighting-product-id" disabled>
                <option value="">Auto</option>
              </select>
            </label>
          </div>
        </details>
        <details class="toolbar-disclosure opening-controls">
          <summary>
            <span class="toolbar-disclosure-title">Openings</span>
            <span class="toolbar-inline-status" data-opening-status>No opening selected</span>
          </summary>
          <div class="toolbar-disclosure-panel merge-controls-panel">
            <label class="room-field">
              <span>Door Product</span>
              <select data-editor-input="opening-door-product-id" disabled>
                <option value="">Default</option>
              </select>
            </label>
          </div>
        </details>
        <details class="toolbar-disclosure paint-controls">
          <summary>
            <span class="toolbar-disclosure-title">Painting</span>
            <span class="toolbar-inline-status" data-painting-status>h 2.70m</span>
          </summary>
          <div class="toolbar-disclosure-panel room-controls-panel">
            <label class="room-field">
              <span>Wall height (m)</span>
              <input
                type="number"
                inputmode="decimal"
                step="0.05"
                min="0.1"
                max="10"
                data-editor-input="wall-height-meters"
                value="2.70"
              >
            </label>
            <button type="button" data-editor-action="wall-height-apply">Apply Height</button>
          </div>
        </details>
        <button type="button" data-editor-action="plan-export-json">Export JSON</button>
        <button type="button" data-editor-action="plan-import-json">Import JSON</button>
        <input type="file" accept="application/json,.json" data-editor-file-input="plan-import" hidden>
        <button type="button" data-editor-action="debug-baseboard-toggle" aria-pressed="false">Baseboard Debug</button>
        <button type="button" data-editor-action="debug-baseboard-conflicts-toggle" aria-pressed="false">Baseboard Conflicts</button>
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
        <aside class="estimate-panel" data-estimate-panel hidden>
          <div class="estimate-panel-header">
            <strong>Estimate Preview</strong>
            <button type="button" data-editor-action="estimate-group-mode-toggle" aria-pressed="false">Group: Room</button>
            <button type="button" data-editor-action="estimate-print">Print / PDF</button>
          </div>
          <div class="estimate-panel-body" data-estimate-body>
            No estimate data yet.
          </div>
        </aside>
        <div class="canvas-overlay" data-editor-overlay>
          Runtime foundation loading...
        </div>
      </div>
    </section>
  `;

  return wrapper;
}
