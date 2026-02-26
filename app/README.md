# App Scaffold

Vanilla JS + ES modules app shell for the apartment planner MVP.

## Run locally

From the repo root:

```sh
bash scripts/dev.sh
```

Open:
- `http://127.0.0.1:4173`

Alternate port:

```sh
bash scripts/dev.sh 8080
```

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
