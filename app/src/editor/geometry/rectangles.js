export function pointInRectangle(point, rectangle) {
  return (
    point.x >= rectangle.x &&
    point.x <= rectangle.x + rectangle.w &&
    point.y >= rectangle.y &&
    point.y <= rectangle.y + rectangle.h
  );
}

export function hitTestRectangles(rectangles, point) {
  for (let index = rectangles.length - 1; index >= 0; index--) {
    const rectangle = rectangles[index];
    if (pointInRectangle(point, rectangle)) {
      return { rectangle, index };
    }
  }
  return null;
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
