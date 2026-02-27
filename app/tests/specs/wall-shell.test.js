import {
  deriveRectangleShellGeometry,
  getRectangleOuterRect,
  getRectangleWallWorld,
  interiorRectToOuterRect,
  outerRectToInteriorRect,
  wallCentimetersToWorld
} from "../../src/editor/geometry/wall-shell.js";
import { assertClose, assertEqual, test } from "../test-runner.js";

test("wall shell converts per-side wall cm to world units using calibrated scale", () => {
  const rectangle = {
    id: "rect_a",
    x: 100,
    y: 200,
    w: 50,
    h: 40,
    wallCm: { top: 10, right: 20, bottom: 30, left: 40 }
  };
  const outerRect = getRectangleOuterRect(rectangle, 0.01);

  assertClose(outerRect.x, 60);
  assertClose(outerRect.y, 190);
  assertClose(outerRect.w, 110);
  assertClose(outerRect.h, 80);
});

test("wall shell uses fallback conversion when scale is not calibrated yet", () => {
  const world = wallCentimetersToWorld(10, null);
  assertClose(world, 5);
});

test("wall shell conversion supports interior -> outer -> interior round-trip", () => {
  const interiorRect = { x: 80, y: 60, w: 140, h: 110 };
  const wallWorld = getRectangleWallWorld({ wallCm: { top: 2, right: 4, bottom: 6, left: 8 } }, 0.02);

  const outerRect = interiorRectToOuterRect(interiorRect, wallWorld);
  const roundTrip = outerRectToInteriorRect(outerRect, wallWorld);

  assertClose(roundTrip.x, interiorRect.x);
  assertClose(roundTrip.y, interiorRect.y);
  assertClose(roundTrip.w, interiorRect.w);
  assertClose(roundTrip.h, interiorRect.h);
});

test("derived shell geometry includes explicit wall band rectangles", () => {
  const rectangle = {
    id: "rect_a",
    x: 10,
    y: 20,
    w: 100,
    h: 50,
    wallCm: { top: 10, right: 0, bottom: 5, left: 15 }
  };
  const shell = deriveRectangleShellGeometry(rectangle, 0.01);

  assertEqual(Boolean(shell.wallBands.top), true);
  assertEqual(Boolean(shell.wallBands.right), false);
  assertEqual(Boolean(shell.wallBands.bottom), true);
  assertEqual(Boolean(shell.wallBands.left), true);
  assertClose(shell.wallBands.top.h, 10);
  assertClose(shell.wallBands.left.w, 15);
});
