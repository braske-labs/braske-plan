import { getRectangleOuterRect } from "./wall-shell.js";

export function deriveTouchingAdjacency(rectangles, options = {}) {
  const touchToleranceWorld = positiveFinite(options.touchToleranceWorld, 1.5);
  const overlapToleranceWorld = nonNegativeFinite(options.overlapToleranceWorld, 1e-3);
  const includeWallShell = options.includeWallShell !== false;
  const metersPerWorldUnit = options.metersPerWorldUnit;
  const candidates = normalizeRoomRectCandidates(rectangles, metersPerWorldUnit, includeWallShell);
  const boundaries = collectSharedBoundaries(candidates, touchToleranceWorld, overlapToleranceWorld);
  const adjacency = new Map(candidates.map((rectangle) => [rectangle.id, new Set()]));

  for (const boundary of boundaries) {
    if (!adjacency.has(boundary.rectangleAId)) {
      adjacency.set(boundary.rectangleAId, new Set());
    }
    if (!adjacency.has(boundary.rectangleBId)) {
      adjacency.set(boundary.rectangleBId, new Set());
    }
    adjacency.get(boundary.rectangleAId).add(boundary.rectangleBId);
    adjacency.get(boundary.rectangleBId).add(boundary.rectangleAId);
  }

  return adjacency;
}

export function isConnectedSelection(selectedIds, adjacency) {
  const normalizedIds = Array.from(
    new Set(
      Array.isArray(selectedIds)
        ? selectedIds.filter((rectangleId) => typeof rectangleId === "string" && rectangleId)
        : []
    )
  );
  if (normalizedIds.length <= 1) {
    return true;
  }

  const selectedSet = new Set(normalizedIds);
  const visited = new Set();
  const stack = [normalizedIds[0]];
  while (stack.length > 0) {
    const current = stack.pop();
    if (visited.has(current)) {
      continue;
    }
    visited.add(current);

    const neighbors = adjacency?.get(current);
    if (!neighbors) {
      continue;
    }
    for (const neighborId of neighbors) {
      if (selectedSet.has(neighborId) && !visited.has(neighborId)) {
        stack.push(neighborId);
      }
    }
  }

  return visited.size === normalizedIds.length;
}

export function deriveRoomSeams(plan, roomId, options = {}) {
  if (typeof roomId !== "string" || !roomId) {
    return {
      roomId: null,
      seams: [],
      seamCount: 0,
      lockedSidesByRectangleId: new Map()
    };
  }

  const touchToleranceWorld = positiveFinite(options.touchToleranceWorld, 1.5);
  const overlapToleranceWorld = nonNegativeFinite(options.overlapToleranceWorld, 1e-3);
  const includeWallShell = options.includeWallShell !== false;
  const metersPerWorldUnit = options.metersPerWorldUnit ?? plan?.scale?.metersPerWorldUnit;
  const rectangles = Array.isArray(plan?.entities?.rectangles) ? plan.entities.rectangles : [];
  const roomRectangles = rectangles.filter((rectangle) => rectangle?.kind !== "wallRect" && rectangle?.roomId === roomId);
  const candidates = normalizeRoomRectCandidates(roomRectangles, metersPerWorldUnit, includeWallShell);
  const boundaries = collectSharedBoundaries(candidates, touchToleranceWorld, overlapToleranceWorld);
  const sideCoverage = buildSideCoverage(boundaries);
  const sideFullMap = buildFullCoverageMap(sideCoverage, overlapToleranceWorld);

  const seams = boundaries.map((boundary, index) => {
    const sideAKey = toSideKey(boundary.rectangleAId, boundary.sideA);
    const sideBKey = toSideKey(boundary.rectangleBId, boundary.sideB);
    return {
      id: `seam_${roomId}_${index + 1}`,
      roomId,
      axis: boundary.axis,
      rectangleAId: boundary.rectangleAId,
      sideA: boundary.sideA,
      rectangleBId: boundary.rectangleBId,
      sideB: boundary.sideB,
      overlapStart: boundary.overlapStart,
      overlapEnd: boundary.overlapEnd,
      overlapLengthWorld: boundary.overlapLengthWorld,
      fullA: sideFullMap.get(sideAKey) === true,
      fullB: sideFullMap.get(sideBKey) === true
    };
  });

  return {
    roomId,
    seams,
    seamCount: seams.length,
    lockedSidesByRectangleId: buildLockedSidesMap(sideFullMap)
  };
}

export function deriveLockedSeamSides(plan, options = {}) {
  const rectangles = Array.isArray(plan?.entities?.rectangles) ? plan.entities.rectangles : [];
  const roomIds = new Set(
    rectangles
      .filter((rectangle) => rectangle?.kind !== "wallRect" && typeof rectangle?.roomId === "string" && rectangle.roomId)
      .map((rectangle) => rectangle.roomId)
  );

  const lockedSidesByRectangleId = new Map();
  for (const roomId of roomIds) {
    const roomSeams = deriveRoomSeams(plan, roomId, options);
    for (const [rectangleId, sideSet] of roomSeams.lockedSidesByRectangleId.entries()) {
      if (!lockedSidesByRectangleId.has(rectangleId)) {
        lockedSidesByRectangleId.set(rectangleId, new Set());
      }
      for (const side of sideSet) {
        lockedSidesByRectangleId.get(rectangleId).add(side);
      }
    }
  }

  return lockedSidesByRectangleId;
}

function normalizeRoomRectCandidates(rectangles, metersPerWorldUnit, includeWallShell) {
  if (!Array.isArray(rectangles)) {
    return [];
  }

  const result = [];
  for (const rectangle of rectangles) {
    if (rectangle?.kind === "wallRect" || !hasRectangleShape(rectangle) || typeof rectangle?.id !== "string" || !rectangle.id) {
      continue;
    }
    const bounds = includeWallShell ? getRectangleOuterRect(rectangle, metersPerWorldUnit) ?? rectangle : rectangle;
    if (!hasRectangleShape(bounds)) {
      continue;
    }
    result.push({
      id: rectangle.id,
      roomId: typeof rectangle.roomId === "string" ? rectangle.roomId : null,
      x: bounds.x,
      y: bounds.y,
      w: bounds.w,
      h: bounds.h
    });
  }
  return result;
}

function collectSharedBoundaries(rectangles, touchToleranceWorld, overlapToleranceWorld) {
  const boundaries = [];

  for (let index = 0; index < rectangles.length; index += 1) {
    const rectangleA = rectangles[index];
    for (let otherIndex = index + 1; otherIndex < rectangles.length; otherIndex += 1) {
      const rectangleB = rectangles[otherIndex];
      appendBoundary(rectangleA, "right", rectangleB, "left");
      appendBoundary(rectangleA, "left", rectangleB, "right");
      appendBoundary(rectangleA, "bottom", rectangleB, "top");
      appendBoundary(rectangleA, "top", rectangleB, "bottom");
    }
  }

  return boundaries;

  function appendBoundary(rectangleA, sideA, rectangleB, sideB) {
    const overlap = deriveBoundaryOverlap(rectangleA, sideA, rectangleB, sideB, touchToleranceWorld, overlapToleranceWorld);
    if (!overlap) {
      return;
    }
    boundaries.push(overlap);
  }
}

function deriveBoundaryOverlap(rectangleA, sideA, rectangleB, sideB, touchToleranceWorld, overlapToleranceWorld) {
  if ((sideA === "left" || sideA === "right") && (sideB === "left" || sideB === "right")) {
    const coordinateA = sideA === "right" ? rectangleA.x + rectangleA.w : rectangleA.x;
    const coordinateB = sideB === "right" ? rectangleB.x + rectangleB.w : rectangleB.x;
    if (!approximatelyEqual(coordinateA, coordinateB, touchToleranceWorld)) {
      return null;
    }

    const interval = makeInterval(
      Math.max(rectangleA.y, rectangleB.y),
      Math.min(rectangleA.y + rectangleA.h, rectangleB.y + rectangleB.h),
      overlapToleranceWorld
    );
    if (!interval) {
      return null;
    }

    return {
      axis: "vertical",
      coordinate: (coordinateA + coordinateB) / 2,
      rectangleAId: rectangleA.id,
      sideA,
      sideALengthWorld: rectangleA.h,
      rectangleBId: rectangleB.id,
      sideB,
      sideBLengthWorld: rectangleB.h,
      overlapStart: interval.start,
      overlapEnd: interval.end,
      overlapLengthWorld: interval.end - interval.start
    };
  }

  if ((sideA === "top" || sideA === "bottom") && (sideB === "top" || sideB === "bottom")) {
    const coordinateA = sideA === "bottom" ? rectangleA.y + rectangleA.h : rectangleA.y;
    const coordinateB = sideB === "bottom" ? rectangleB.y + rectangleB.h : rectangleB.y;
    if (!approximatelyEqual(coordinateA, coordinateB, touchToleranceWorld)) {
      return null;
    }

    const interval = makeInterval(
      Math.max(rectangleA.x, rectangleB.x),
      Math.min(rectangleA.x + rectangleA.w, rectangleB.x + rectangleB.w),
      overlapToleranceWorld
    );
    if (!interval) {
      return null;
    }

    return {
      axis: "horizontal",
      coordinate: (coordinateA + coordinateB) / 2,
      rectangleAId: rectangleA.id,
      sideA,
      sideALengthWorld: rectangleA.w,
      rectangleBId: rectangleB.id,
      sideB,
      sideBLengthWorld: rectangleB.w,
      overlapStart: interval.start,
      overlapEnd: interval.end,
      overlapLengthWorld: interval.end - interval.start
    };
  }

  return null;
}

function buildSideCoverage(boundaries) {
  const sideCoverage = new Map();

  for (const boundary of boundaries) {
    appendCoverage(boundary.rectangleAId, boundary.sideA, boundary.sideALengthWorld, boundary.overlapStart, boundary.overlapEnd);
    appendCoverage(boundary.rectangleBId, boundary.sideB, boundary.sideBLengthWorld, boundary.overlapStart, boundary.overlapEnd);
  }

  return sideCoverage;

  function appendCoverage(rectangleId, side, sideLengthWorld, start, end) {
    const key = toSideKey(rectangleId, side);
    if (!sideCoverage.has(key)) {
      sideCoverage.set(key, { lengthWorld: sideLengthWorld, intervals: [] });
    }
    sideCoverage.get(key).intervals.push({ start, end });
  }
}

function buildFullCoverageMap(sideCoverage, overlapToleranceWorld) {
  const sideFullMap = new Map();
  for (const [sideKey, coverage] of sideCoverage.entries()) {
    const merged = mergeIntervals(coverage.intervals, overlapToleranceWorld);
    const coveredLengthWorld = merged.reduce((sum, interval) => sum + (interval.end - interval.start), 0);
    const fullCoverage = coveredLengthWorld >= Math.max(0, coverage.lengthWorld - overlapToleranceWorld);
    sideFullMap.set(sideKey, fullCoverage);
  }
  return sideFullMap;
}

function buildLockedSidesMap(sideFullMap) {
  const map = new Map();
  for (const [sideKey, isFullCoverage] of sideFullMap.entries()) {
    if (!isFullCoverage) {
      continue;
    }
    const [rectangleId, side] = sideKey.split(":");
    if (!rectangleId || !side) {
      continue;
    }
    if (!map.has(rectangleId)) {
      map.set(rectangleId, new Set());
    }
    map.get(rectangleId).add(side);
  }
  return map;
}

function toSideKey(rectangleId, side) {
  return `${rectangleId}:${side}`;
}

function mergeIntervals(intervals, overlapToleranceWorld) {
  if (!Array.isArray(intervals) || intervals.length === 0) {
    return [];
  }
  const normalized = intervals
    .filter((interval) => interval && Number.isFinite(interval.start) && Number.isFinite(interval.end))
    .filter((interval) => interval.end - interval.start > overlapToleranceWorld)
    .sort((a, b) => a.start - b.start || a.end - b.end);
  if (normalized.length === 0) {
    return [];
  }

  const merged = [normalized[0]];
  for (let index = 1; index < normalized.length; index += 1) {
    const previous = merged[merged.length - 1];
    const current = normalized[index];
    if (current.start <= previous.end + overlapToleranceWorld) {
      previous.end = Math.max(previous.end, current.end);
      continue;
    }
    merged.push(current);
  }
  return merged;
}

function makeInterval(start, end, overlapToleranceWorld) {
  if (!Number.isFinite(start) || !Number.isFinite(end)) {
    return null;
  }
  if (!(end - start > overlapToleranceWorld)) {
    return null;
  }
  return { start, end };
}

function hasRectangleShape(rectangle) {
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

function positiveFinite(value, fallback) {
  return Number.isFinite(value) && value > 0 ? value : fallback;
}

function nonNegativeFinite(value, fallback) {
  return Number.isFinite(value) && value >= 0 ? value : fallback;
}

function approximatelyEqual(a, b, epsilon) {
  return Math.abs(a - b) <= epsilon;
}
