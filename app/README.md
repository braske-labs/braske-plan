# App Scaffold

Vanilla JS app shell for the apartment planner MVP, now served locally with Vite.

## Run locally

Install dependencies:

```sh
cd app
corepack pnpm install
```

Then start the Vite dev server:

```sh
cd app
corepack pnpm dev
```

Open:
- `http://127.0.0.1:4173`

Alternate port:

```sh
cd app
corepack pnpm dev -- --host 127.0.0.1 --port 8080 --strictPort
```

## Snapping reference (for humans)

For current snapping rules and a scenario-by-scenario manual check list, see:
- `docs/snapping_scenarios.md`

## T-0004 manual smoke check (runtime foundation)

1. Start the server and open `http://127.0.0.1:4173`.
2. Confirm the sidebar says `T-0004` and the toolbar shows:
   - `New Empty Plan`
   - `Seed Debug Rects`
   - `Reset View`
3. Confirm the canvas shows:
   - a grid
   - axis lines around world origin (when visible)
   - debug rectangles after load (or after pressing `Seed Debug Rects`)
4. Drag on the canvas:
   - camera pans
   - status text camera coordinates change
5. Use mouse wheel over a visible rectangle:
   - zoom changes
   - zoom is cursor-anchored (the point under the cursor stays approximately fixed)
6. Press `Reset View`:
   - camera returns to default framing
7. Press `New Empty Plan`:
   - debug rectangles disappear
8. Press `Seed Debug Rects`:
   - debug rectangles return

This slice does **not** include rectangle selection/drag/create/resize yet. Those are `T-0005` and `T-0006`.

## T-0005 manual smoke check (rectangle selection + drag)

1. Keep the app running and ensure debug rectangles are visible (press `Seed Debug Rects` if needed).
2. Click a rectangle:
   - it gets a blue selection outline
   - top-left debug box shows `Selected: ...`
3. Drag the selected rectangle:
   - rectangle moves smoothly
   - camera does **not** pan during the drag
4. Drag empty canvas area:
   - camera pans
   - rectangles stay in place relative to world coordinates
5. Use mouse wheel over/near a rectangle:
   - zoom changes and remains cursor-anchored
6. Click empty canvas:
   - selection clears
7. Press `New Empty Plan`, then `Seed Debug Rects` again:
   - selection/drag still works after plan replacement

This slice still excludes create/resize/snapping/magnetic links (`T-0006` and later).

## T-0006 manual smoke check (rectangle create + resize, no snapping)

1. Start the server and open `http://127.0.0.1:4173`.
2. Confirm the sidebar says `T-0006` and the toolbar shows:
   - `Navigate`
   - `Draw Rect`
   - `New Empty Plan`
   - `Seed Debug Rects`
3. In `Draw Rect` mode:
   - drag on empty canvas to create a rectangle
   - a new rectangle appears and becomes selected
4. Try a tiny click/drag in `Draw Rect` mode:
   - no rectangle should be created (minimum size threshold)
5. Switch to `Navigate` mode and click the created rectangle:
   - selection outline appears
   - resize handles are visible
6. Drag a corner or edge handle:
   - rectangle resizes smoothly
   - width/height cannot collapse below the minimum threshold
7. Drag inside the rectangle (not a handle):
   - rectangle moves (existing `T-0005` behavior still works)
8. Drag empty canvas:
   - camera pans (no regression)
9. Use mouse wheel while hovering canvas:
   - zoom remains functional
10. Press `New Empty Plan`, then `Draw Rect`:
   - creating/resizing still works after plan reset

This slice intentionally excludes snapping/magnetic alignment. Those come later.

## T-0003 manual smoke check (autosave + reopen last plan)

1. Start the server and open `http://127.0.0.1:4173`.
2. Confirm the sidebar says `T-0003` and the status/overlay mentions autosave.
3. Make a visible edit:
   - move a rectangle, or
   - create a new rectangle, or
   - resize a rectangle
4. Wait about 1 second:
   - status should show an autosave message (`pending` -> `saved`)
5. Reload the page:
   - the edited plan state should reopen automatically (same rectangles/positions/sizes)
6. Press `New Empty Plan`, wait for autosave, then reload:
   - the empty plan state should reopen (reset persists)
7. Press `Seed Debug Rects`, wait for autosave, then reload:
   - seeded rectangles should reopen again

This ticket persists the `plan` only. Camera/tool/selection are intentionally transient.

## T-0007 manual smoke check (background overlay controls)

1. Start the server and open `http://127.0.0.1:4173`.
2. Confirm the sidebar says `T-0007` and the toolbar shows background controls (`Opacity`, `Left/Right/Up/Down`, `Scale`).
   - controls may be inside a collapsed `BG Controls` disclosure
3. Confirm the background image is visible in the dashed frame area (not just a blank placeholder).
4. Press `Opacity -` and `Opacity +`:
   - image becomes more/less visible
   - toolbar/status reflects updated background state
5. Press `Left/Right/Up/Down`:
   - background image shifts while rectangles remain unchanged
6. Press `Scale -` and `Scale +`:
   - background image scales uniformly (frame size changes)
7. Verify existing editor interactions still work with background visible:
   - pan, zoom, select, drag, create, resize
8. Make a background adjustment, wait for autosave, reload page:
   - background position/size/opacity reopen with the latest values

This ticket intentionally excludes rotation/warping/upload UI.

## T-0010 manual smoke check (delete selected rectangle)

1. Start the server and open `http://127.0.0.1:4173`.
2. Ensure at least one rectangle exists (seed or create one).
3. Click a rectangle to select it, then press `Delete Rect`:
   - rectangle is removed
   - selection clears
4. Create/select another rectangle and press keyboard `Delete` or `Backspace`:
   - rectangle is removed
   - page does not navigate backward
5. With no rectangle selected, press `Delete` / `Backspace`:
   - safe no-op (no crash, no navigation)
6. Reload after a delete:
   - deletion persists (autosave integration)

## T-0008 manual smoke check (basic snapping: edge/corner alignment)

1. Start the server and open `http://127.0.0.1:4173`.
2. Ensure at least two rectangles exist (use `Seed Debug Rects` plus create one if needed).
3. Drag one rectangle near another rectangle edge:
   - movement snaps when close (within a small pixel tolerance)
4. Drag near another rectangle corner:
   - x and y both snap when close, producing corner alignment
5. Resize a selected rectangle edge/corner near another rectangle edge/corner:
   - active edge/corner snaps while resizing
6. Zoom in and out, then repeat drag/resize snaps:
   - snap feel remains consistent across zoom levels (pixel-based tolerance)
7. Confirm no persistent linking behavior:
   - after snapping, moving the other rectangle does not move the snapped rectangle
8. Confirm existing interactions still work:
   - pan, background controls, delete-selected, autosave/reload

This ticket does not add magnetic links/unlink persistence.

## T-0011 manual test-harness check (pure unit tests in browser)

1. Start the server and open `http://127.0.0.1:4173/tests/`.
2. Confirm the page loads a test summary and a list of test cases.
3. Confirm the summary shows `PASS` (all tests green).
4. If any test fails:
   - copy the failing test name / stack from the page
   - report it before continuing feature work

This harness is dependency-free and runs in the browser because local Node is currently broken on this machine (`icu4c` mismatch).

## T-0009 manual smoke check (scale calibration: reference line -> meters)

1. Start the server and open `http://127.0.0.1:4173`.
2. Confirm the toolbar shows both `Calibrate Scale` and `Calibrate by Area`.
3. Click `Calibrate Scale`, then drag a visible reference line on the canvas:
   - a dashed orange draft line appears during drag
   - line length in world units is shown near the draft line
4. Release the pointer:
   - a prompt asks for the real-world length in meters
   - enter a positive number (for example `3.2`)
5. Confirm the app shows a scale readout:
   - toolbar inline scale status updates
   - status/overlay mentions the calibrated scale
   - an orange dashed reference line remains visible on the canvas
6. Recalibrate with a different line and/or meters value:
   - previous scale is replaced cleanly
   - readouts update to the new calibration
7. Reload the page after autosave:
   - scale readout and reference line reopen from saved plan
8. Confirm existing interactions still work:
   - navigate pan/zoom
   - draw/create/resize rectangles
   - snapping
   - delete rectangle

### Area-based scale calibration quick check

1. Ensure at least one room is active (click a room in the left sidebar).
2. Confirm `Calibrate by Area` is enabled.
3. Click `Calibrate by Area` and enter known room area in m².
4. Confirm scale status updates and room/rectangle metric readouts follow the new calibration.

## T-0014 manual smoke check (selected rectangle dimensions: world + meters/cm)

1. Start the server and open `http://127.0.0.1:4173`.
2. Ensure at least one rectangle exists (`Seed Debug Rects` is fine).
3. Click a rectangle to select it.
4. Confirm selected dimensions appear in:
   - the top-left debug overlay (`Sel world`, `Sel metric`)
   - the status line (compact selected dimensions)

## T-0024 manual smoke check (merge room workflow + seam locks)

1. Start the server and open `http://127.0.0.1:4173`.
2. Check left `Rooms` panel:
   - each room appears with its own color chip
   - sidebar header shows total area + total baseboard across all room entries
   - merged room members share the same color on canvas
   - unassigned rectangles still appear (using rectangle id fallback)
   - click room item to activate/select it; double-click to center view
3. Draw two touching `roomRect` rectangles (or use existing touching room rectangles).
4. (Optional) set a room name/type in `Room Tag`, click `Merge Room`, then click both rectangles:
   - both rectangles show merge-candidate outlines
   - room panel status shows connected/ready once selection is valid
5. Click `Complete Merge`:
   - tool returns to `Navigate`
   - both rectangles share one room assignment
   - merge works even if name is blank (fallback name `Merged Room`)
6. Try dragging one merged rectangle body:
   - all member rectangles move together as one glued room
7. Try resizing a locked seam side handle:
   - by default it is blocked (gray handle style)
8. Toggle `Internal Slides: On` and drag a locked side handle (`N/E/S/W`):
   - the internal seam slides
   - both touching rectangles resize together while staying glued
9. Select any member rectangle and click `Dissolve Room`:
   - room assignment clears from all members
   - room entity is removed
10. With a room active, verify left details show:
   - area (sum of room member interior rectangles)
   - baseboard total for that room
   - active room color matches canvas room tint

## T-0015 manual smoke check (on-canvas selected-rectangle dimension labels)

1. Start the server and open `http://127.0.0.1:4173`.
2. Ensure at least one rectangle exists and click it to select.
3. Confirm on-canvas labels appear near the selected rectangle:
   - width label (`W ...`)
   - height label (`H ...`)
4. Before scale calibration (or after clearing scale in a fresh plan):
   - labels show explicit world-unit fallback (`wu`)
   - no crashes / no `NaN`
5. After scale calibration:
   - labels show meters/cm formatting
   - labels update live while dragging and resizing the selected rectangle
6. Pan and zoom around:
   - labels remain legible (screen-space text size)
   - labels reposition sensibly around the selected rectangle
   - interactions (drag/resize/pan) still work normally
7. Hover near top-right while a rectangle is selected:
   - hover tooltip still appears
   - labels do not hide critical UI readouts in a broken way

## T-0016 manual smoke check (basic geometry validation status checks)

1. Start the server and open `http://127.0.0.1:4173`.
2. On a fresh/new plan (before calibration):
   - debug overlay shows a validation warning state (`WARN`)
   - status/overlay text includes a validation warning mentioning missing scale
3. Calibrate scale:
   - missing-scale warning disappears (or warning count decreases if other warnings remain)
   - validation summary updates without breaking interactions
4. Create or drag rectangles so two rectangles overlap with area (not just touching edges):
   - validation warning shows overlap warning/count
   - overlapping rectangles flash red in the canvas (pair-by-pair) so conflict locations are visible
5. Move rectangles apart so they only touch edges:
   - overlap warning should clear (edge-touch is allowed)
6. Confirm app remains responsive during drag/resize/pan/zoom with validation visible.
7. Optional: open `http://127.0.0.1:4173/tests/` and confirm validation tests are listed in the browser test harness.

## T-0017 manual smoke check (export/import plan JSON local round-trip)

1. Start the server and open `http://127.0.0.1:4173`.
2. Make a visible plan change (create/move/resize rectangle and/or calibrate scale).
3. Click `Export JSON`:
   - browser downloads a `.json` file
   - status/debug/overlay shows file I/O exported state
4. Click `New Empty Plan` and confirm the canvas is cleared.
5. Click `Import JSON` and choose the exported file:
   - plan is restored (rectangles/background/scale as applicable)
   - editor does not crash
   - status/debug/overlay shows file I/O imported state
6. After import, confirm normal interactions still work:
   - select/drag/resize
   - pan/zoom
   - delete rectangle
   - autosave/reload still works
7. Invalid file safety check:
   - try importing a non-JSON or malformed JSON file
   - app stays responsive and shows a safe file I/O error message (no crash)

## T-0018 manual smoke check (per-side wall thickness controls)

1. Start the server and open `http://127.0.0.1:4173`.
2. Ensure at least one rectangle exists and select it.
3. Open `Wall Cm` controls in the toolbar:
   - current `Top/Right/Bottom/Left` values are shown
   - summary status shows side values for selected rectangle
4. Use `+` / `-` on each side:
   - values update immediately in the wall controls
   - status/overlay reflects updated wall values
   - visible wall shell thickness changes outward around the room interior
5. Clear selection (click empty area):
   - wall controls become disabled
   - safe `No selection` / `-` values are shown
6. Re-select rectangle and verify wall values persisted.
7. Confirm core interactions still work normally after wall edits:
   - draw/select/drag/resize/snapping
   - clicking a wall band still selects/drags the room piece
   - snapping uses shell contact (outer wall edges), not interior-only edges
   - autosave/reload
8. Optional: open `http://127.0.0.1:4173/tests/` and confirm wall-shell/snapping tests pass.

## T-0019 manual smoke check (baseboard candidates + red debug overlay)

1. Start the server and open `http://127.0.0.1:4173`.
2. Ensure at least one room rectangle exists with non-zero wall thickness on at least one side.
3. Click `Baseboard Debug` in the toolbar:
   - button enters pressed state
   - fat red lines appear on counted room sides
4. Click `Baseboard Debug` again:
   - red lines hide without affecting geometry
5. Change wall thickness (`Wall Cm`) on selected room sides:
   - counted red segments update on next frame
6. Add or move a `wallRect` that touches a room side with zero `wallCm`:
   - that side can appear as a counted candidate (wall support via `wallRect`)
7. Confirm status/overlay text includes baseboard candidate count/length.
8. Optional: open `http://127.0.0.1:4173/tests/` and confirm baseboard tests pass.
9. Partial support check:
   - make a room side touched by a short `wallRect` only on part of the edge
   - only the touched interval should be counted (not the whole side)
10. Same-room seam check:
   - create two touching rectangles with the same `roomId`
   - if both seam sides have support, that seam should be pruned from kept red segments
11. Enclosure check prep:
   - sides not covered by own support or supported neighbors should remain visible in diagnostics (`unsupportedOpenSides` in helper output).

## T-0022 manual smoke check (`is wall` / rectangle kind toggle)

1. Start the server and open `http://127.0.0.1:4173`.
2. Create or select a room rectangle.
3. Click `Set As Wall`:
   - selected rectangle changes to wall styling
   - button changes to `Set As Room`
   - `Wall Cm` controls show wall-editing disabled state
4. Drag/resize the wall rectangle:
   - interactions remain smooth and unchanged
5. Click `Set As Room`:
   - rectangle returns to room styling
   - `Wall Cm` controls are enabled again for that selection
6. Toggle `Baseboard Debug`:
   - room rectangles contribute candidates
   - wall rectangles can act as touching wall support for room sides
7. Reload after autosave:
   - selected rectangles preserve `roomRect`/`wallRect` kind.
