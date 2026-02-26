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
