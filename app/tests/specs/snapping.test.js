import { snapDraggedRectangle, snapResizedRectangle } from "../../src/editor/geometry/snapping.js";
import { assertClose, assertEqual, test } from "../test-runner.js";

function rectangle(id, x, y, w, h) {
  return { id, x, y, w, h };
}

test("drag snapping does not free-align same edges without contact", () => {
  const target = rectangle("rect_target", 0, 0, 100, 100);
  const proposed = { x: 220, y: 3, w: 80, h: 80 };

  const result = snapDraggedRectangle(proposed, [target], { toleranceWorld: 6 });

  assertEqual(result.snap.x, null);
  assertEqual(result.snap.y, null);
  assertClose(result.rectangle.x, 220);
  assertClose(result.rectangle.y, 3);
});

test("drag snapping snaps edge contact when overlap exists", () => {
  const target = rectangle("rect_target", 0, 0, 100, 100);
  const proposed = { x: 102, y: 20, w: 80, h: 80 };

  const result = snapDraggedRectangle(proposed, [target], { toleranceWorld: 3 });

  assertClose(result.rectangle.x, 100);
  assertClose(result.rectangle.y, 20);
  assertEqual(result.snap.x?.target?.rectangleId, "rect_target");
});

test("drag snapping supports corner-touch top-bottom alignment", () => {
  const target = rectangle("rect_target", 0, 0, 100, 100);
  const proposed = { x: 101, y: 102, w: 60, h: 60 };

  const result = snapDraggedRectangle(proposed, [target], { toleranceWorld: 3 });

  assertClose(result.rectangle.x, 100);
  assertClose(result.rectangle.y, 100);
  assertEqual(result.snap.x?.target?.rectangleId, "rect_target");
  assertEqual(result.snap.y?.target?.rectangleId, "rect_target");
});

test("drag snapping allows top-top alignment while side-touch is already satisfied", () => {
  const target = rectangle("rect_target", 0, 0, 100, 100);
  const proposed = { x: 100, y: 4, w: 60, h: 60 };

  const result = snapDraggedRectangle(proposed, [target], { toleranceWorld: 6 });

  assertClose(result.rectangle.x, 100);
  assertClose(result.rectangle.y, 0);
  assertEqual(result.snap.y?.target?.rectangleId, "rect_target");
});

test("drag snapping composes contact + top-top alignment when x contact needs correction", () => {
  const target = rectangle("rect_target", 0, 0, 100, 100);
  const proposed = { x: 102, y: 4, w: 60, h: 60 };

  const result = snapDraggedRectangle(proposed, [target], { toleranceWorld: 6 });

  assertClose(result.rectangle.x, 100);
  assertClose(result.rectangle.y, 0);
  assertEqual(result.snap.x?.target?.rectangleId, "rect_target");
  assertEqual(result.snap.y?.target?.rectangleId, "rect_target");
});

test("drag snapping allows bottom-bottom alignment while side-touch is already satisfied", () => {
  const target = rectangle("rect_target", 0, 0, 100, 100);
  const proposed = { x: 100, y: 38, w: 60, h: 60 };

  const result = snapDraggedRectangle(proposed, [target], { toleranceWorld: 4 });

  assertClose(result.rectangle.x, 100);
  assertClose(result.rectangle.y, 40);
  assertEqual(result.snap.y?.target?.rectangleId, "rect_target");
});

test("resize snapping allows same-edge alignment when already side-touching", () => {
  const target = rectangle("rect_target", 0, 0, 100, 100);
  const proposed = { x: 100, y: 4, w: 80, h: 96 };

  const result = snapResizedRectangle(proposed, "n", [target], {
    toleranceWorld: 6,
    minSize: 16
  });

  assertClose(result.rectangle.y, 0);
  assertClose(result.rectangle.h, 100);
  assertEqual(result.snap.y?.target?.rectangleId, "rect_target");
});
