import { validateBasicPlanGeometry } from "../../src/editor/geometry/validation.js";
import { createEmptyPlan } from "../../src/editor/state/plan.js";
import { assert, assertEqual, test } from "../test-runner.js";

function makeRect(id, x, y, w, h) {
  return {
    id,
    kind: "roomRect",
    x,
    y,
    w,
    h,
    wallCm: { top: 0, right: 0, bottom: 0, left: 0 },
    roomId: null,
    label: null
  };
}

test("basic validation warns when scale is missing", () => {
  const plan = createEmptyPlan();

  const result = validateBasicPlanGeometry(plan);

  assertEqual(result.status, "warning");
  assert(result.findings.some((finding) => finding.code === "scale_missing"), "Expected missing-scale warning.");
});

test("basic validation detects rectangle overlap but ignores edge touching", () => {
  const base = createEmptyPlan();
  const plan = {
    ...base,
    scale: {
      metersPerWorldUnit: 0.01,
      referenceLine: { x0: 0, y0: 0, x1: 100, y1: 0, meters: 1 }
    },
    entities: {
      ...base.entities,
      rectangles: [
        makeRect("a", 0, 0, 100, 100),
        makeRect("b", 50, 40, 90, 60),
        makeRect("c", 140, 0, 60, 100)
      ]
    }
  };

  const result = validateBasicPlanGeometry(plan);
  const overlapFinding = result.findings.find((finding) => finding.code === "rectangle_overlap");

  assert(overlapFinding != null, "Expected overlap warning.");
  assertEqual(overlapFinding.count, 1);
  assertEqual(result.overlapPairs.length, 1);
  assertEqual(result.overlapPairs[0].aId, "a");
  assertEqual(result.overlapPairs[0].bId, "b");
});

test("basic validation detects invalid rectangle geometry", () => {
  const base = createEmptyPlan();
  const plan = {
    ...base,
    entities: {
      ...base.entities,
      rectangles: [
        makeRect("ok", 0, 0, 100, 100),
        makeRect("bad", 20, 20, 0, 40)
      ]
    }
  };

  const result = validateBasicPlanGeometry(plan);

  assert(result.findings.some((finding) => finding.code === "invalid_rectangle_geometry"), "Expected invalid-geometry warning.");
});
