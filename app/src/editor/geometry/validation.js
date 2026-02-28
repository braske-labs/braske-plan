export function validateBasicPlanGeometry(plan, options = {}) {
  const rectangles = Array.isArray(plan?.entities?.rectangles) ? plan.entities.rectangles : [];
  const findings = [];
  const maxOverlapPairs = Number.isInteger(options.maxOverlapPairs) && options.maxOverlapPairs > 0
    ? options.maxOverlapPairs
    : 32;

  const duplicateRectangleIds = findDuplicateRectangleIds(rectangles);
  if (duplicateRectangleIds.length > 0) {
    findings.push({
      code: "duplicate_rectangle_ids",
      severity: "warning",
      message: `${duplicateRectangleIds.length} duplicate rectangle id${duplicateRectangleIds.length === 1 ? "" : "s"}`,
      count: duplicateRectangleIds.length
    });
  }

  const invalidRectangleCount = countInvalidRectangles(rectangles);
  if (invalidRectangleCount > 0) {
    findings.push({
      code: "invalid_rectangle_geometry",
      severity: "warning",
      message: `${invalidRectangleCount} rectangle${invalidRectangleCount === 1 ? "" : "s"} with invalid geometry`,
      count: invalidRectangleCount
    });
  }

  const overlapSummary = collectOverlappingRectanglePairs(rectangles, maxOverlapPairs);
  if (overlapSummary.count > 0) {
    findings.push({
      code: "rectangle_overlap",
      severity: "warning",
      message: `${overlapSummary.count} overlapping rectangle pair${overlapSummary.count === 1 ? "" : "s"}`,
      count: overlapSummary.count,
      pairs: overlapSummary.pairs
    });
  }

  if (!isPositiveFinite(plan?.scale?.metersPerWorldUnit)) {
    findings.push({
      code: "scale_missing",
      severity: "warning",
      message: "Scale not calibrated",
      count: 1
    });
  }

  const warningCount = findings.filter((finding) => finding.severity === "warning").length;
  const infoCount = findings.filter((finding) => finding.severity === "info").length;

  return {
    status: warningCount > 0 ? "warning" : "ok",
    warningCount,
    infoCount,
    rectangleCount: rectangles.length,
    findings,
    overlapPairs: overlapSummary.pairs
  };
}

function findDuplicateRectangleIds(rectangles) {
  const seen = new Set();
  const duplicates = new Set();

  for (const rectangle of rectangles) {
    const id = typeof rectangle?.id === "string" ? rectangle.id : null;
    if (!id) {
      continue;
    }
    if (seen.has(id)) {
      duplicates.add(id);
      continue;
    }
    seen.add(id);
  }

  return [...duplicates];
}

function countInvalidRectangles(rectangles) {
  let count = 0;
  for (const rectangle of rectangles) {
    if (!hasValidRectangleGeometry(rectangle)) {
      count += 1;
    }
  }
  return count;
}

function collectOverlappingRectanglePairs(rectangles, maxPairs) {
  const validRectangles = rectangles
    .map((rectangle, index) => ({ rectangle, index }))
    .filter((entry) => hasValidRectangleGeometry(entry.rectangle));
  const pairs = [];

  for (let index = 0; index < validRectangles.length; index += 1) {
    const a = validRectangles[index];
    for (let otherIndex = index + 1; otherIndex < validRectangles.length; otherIndex += 1) {
      const b = validRectangles[otherIndex];
      if (!rectanglesOverlapWithArea(a.rectangle, b.rectangle)) {
        continue;
      }

      pairs.push({
        aIndex: a.index,
        bIndex: b.index,
        aId: toRectangleId(a.rectangle, a.index),
        bId: toRectangleId(b.rectangle, b.index)
      });
      if (pairs.length >= maxPairs) {
        return { count: pairs.length, pairs };
      }
    }
  }

  return { count: pairs.length, pairs };
}

function hasValidRectangleGeometry(rectangle) {
  return (
    rectangle != null &&
    Number.isFinite(rectangle.x) &&
    Number.isFinite(rectangle.y) &&
    Number.isFinite(rectangle.w) &&
    Number.isFinite(rectangle.h) &&
    rectangle.w > 0 &&
    rectangle.h > 0
  );
}

function rectanglesOverlapWithArea(a, b) {
  return (
    a.x < b.x + b.w &&
    a.x + a.w > b.x &&
    a.y < b.y + b.h &&
    a.y + a.h > b.y
  );
}

function toRectangleId(rectangle, fallbackIndex) {
  if (typeof rectangle?.id === "string" && rectangle.id) {
    return rectangle.id;
  }
  return `rect_${fallbackIndex + 1}`;
}

function isPositiveFinite(value) {
  return Number.isFinite(value) && value > 0;
}
