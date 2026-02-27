export function pointInRectangle(point, rectangle) {
  return (
    point.x >= rectangle.x &&
    point.x <= rectangle.x + rectangle.w &&
    point.y >= rectangle.y &&
    point.y <= rectangle.y + rectangle.h
  );
}

export function hitTestRectangles(rectangles, point, options = {}) {
  const getBounds = typeof options.getBounds === "function" ? options.getBounds : null;
  for (let index = rectangles.length - 1; index >= 0; index--) {
    const rectangle = rectangles[index];
    const bounds = getBounds ? getBounds(rectangle) : rectangle;
    if (!bounds) {
      continue;
    }
    if (pointInRectangle(point, bounds)) {
      return { rectangle, index, bounds };
    }
  }
  return null;
}

export function normalizeRectangleFromPoints(startPoint, endPoint) {
  const x = Math.min(startPoint.x, endPoint.x);
  const y = Math.min(startPoint.y, endPoint.y);
  const w = Math.abs(endPoint.x - startPoint.x);
  const h = Math.abs(endPoint.y - startPoint.y);
  return { x, y, w, h };
}

export function computeRectangleDragOffset(rectangle, worldPoint) {
  return {
    x: worldPoint.x - rectangle.x,
    y: worldPoint.y - rectangle.y
  };
}

export function computeRectanglePositionFromPointer(worldPoint, dragOffset) {
  return {
    x: worldPoint.x - dragOffset.x,
    y: worldPoint.y - dragOffset.y
  };
}

export function getResizeHandles(rectangle, cameraZoom, options = {}) {
  const handleSizePx = options.handleSizePx ?? 12;
  const sizeWorld = handleSizePx / cameraZoom;
  const half = sizeWorld / 2;

  const xMin = rectangle.x;
  const xMax = rectangle.x + rectangle.w;
  const yMin = rectangle.y;
  const yMax = rectangle.y + rectangle.h;
  const xMid = rectangle.x + rectangle.w / 2;
  const yMid = rectangle.y + rectangle.h / 2;

  return [
    { name: "nw", x: xMin - half, y: yMin - half, w: sizeWorld, h: sizeWorld },
    { name: "n", x: xMid - half, y: yMin - half, w: sizeWorld, h: sizeWorld },
    { name: "ne", x: xMax - half, y: yMin - half, w: sizeWorld, h: sizeWorld },
    { name: "e", x: xMax - half, y: yMid - half, w: sizeWorld, h: sizeWorld },
    { name: "se", x: xMax - half, y: yMax - half, w: sizeWorld, h: sizeWorld },
    { name: "s", x: xMid - half, y: yMax - half, w: sizeWorld, h: sizeWorld },
    { name: "sw", x: xMin - half, y: yMax - half, w: sizeWorld, h: sizeWorld },
    { name: "w", x: xMin - half, y: yMid - half, w: sizeWorld, h: sizeWorld }
  ];
}

export function hitTestResizeHandles(rectangle, point, cameraZoom, options = {}) {
  const handles = getResizeHandles(rectangle, cameraZoom, options);
  for (let index = handles.length - 1; index >= 0; index--) {
    const handle = handles[index];
    if (
      point.x >= handle.x &&
      point.x <= handle.x + handle.w &&
      point.y >= handle.y &&
      point.y <= handle.y + handle.h
    ) {
      return handle;
    }
  }
  return null;
}

export function resizeRectangleFromHandle(snapshotRectangle, handleName, pointerWorld, options = {}) {
  const minSize = options.minSize ?? 16;

  const xMin0 = snapshotRectangle.x;
  const xMax0 = snapshotRectangle.x + snapshotRectangle.w;
  const yMin0 = snapshotRectangle.y;
  const yMax0 = snapshotRectangle.y + snapshotRectangle.h;

  let xMin = xMin0;
  let xMax = xMax0;
  let yMin = yMin0;
  let yMax = yMax0;

  if (handleName.includes("w")) {
    xMin = Math.min(pointerWorld.x, xMax0 - minSize);
  }
  if (handleName.includes("e")) {
    xMax = Math.max(pointerWorld.x, xMin0 + minSize);
  }
  if (handleName.includes("n")) {
    yMin = Math.min(pointerWorld.y, yMax0 - minSize);
  }
  if (handleName.includes("s")) {
    yMax = Math.max(pointerWorld.y, yMin0 + minSize);
  }

  return {
    x: xMin,
    y: yMin,
    w: xMax - xMin,
    h: yMax - yMin
  };
}

export function rectangleMeetsMinimumSize(rectangle, minSize) {
  return rectangle.w >= minSize && rectangle.h >= minSize;
}
