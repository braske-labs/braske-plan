import {
  buildScaleCalibration,
  computeMetersPerWorldUnitFromArea,
  computeMetersPerWorldUnit,
  distanceBetweenWorldPoints,
  formatMetersAndCentimeters,
  worldLengthToMeters
} from "../../src/editor/geometry/scale.js";
import { assertClose, assertEqual, test } from "../test-runner.js";

test("distanceBetweenWorldPoints returns Euclidean distance", () => {
  const distance = distanceBetweenWorldPoints({ x: 0, y: 0 }, { x: 3, y: 4 });
  assertClose(distance, 5);
});

test("computeMetersPerWorldUnit rejects invalid inputs", () => {
  assertEqual(computeMetersPerWorldUnit(0, 2), null);
  assertEqual(computeMetersPerWorldUnit(10, 0), null);
  assertEqual(computeMetersPerWorldUnit(-10, 2), null);
});

test("computeMetersPerWorldUnitFromArea converts area ratio to linear scale", () => {
  assertClose(computeMetersPerWorldUnitFromArea(100, 4), 0.2);
  assertEqual(computeMetersPerWorldUnitFromArea(0, 4), null);
  assertEqual(computeMetersPerWorldUnitFromArea(100, 0), null);
});

test("buildScaleCalibration returns reference line and meters-per-unit", () => {
  const calibration = buildScaleCalibration({ x: 10, y: 10 }, { x: 30, y: 10 }, 4);
  assertClose(calibration.worldLength, 20);
  assertClose(calibration.metersPerWorldUnit, 0.2);
  assertEqual(calibration.referenceLine.meters, 4);
  assertClose(calibration.referenceLine.x0, 10);
  assertClose(calibration.referenceLine.x1, 30);
});

test("worldLengthToMeters converts world units using scale", () => {
  assertClose(worldLengthToMeters(200, 0.015), 3);
  assertEqual(worldLengthToMeters(-1, 0.02), null);
  assertEqual(worldLengthToMeters(10, null), null);
});

test("formatMetersAndCentimeters returns a stable metric label", () => {
  assertEqual(formatMetersAndCentimeters(3.2), "3.20 m (320.0 cm)");
  assertEqual(
    formatMetersAndCentimeters(0.375, { metersDecimals: 3, centimetersDecimals: 2 }),
    "0.375 m (37.50 cm)"
  );
  assertEqual(formatMetersAndCentimeters(-1), null);
});
