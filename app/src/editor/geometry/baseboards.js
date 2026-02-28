import { normalizeWallCm, wallCentimetersToWorld } from "./wall-shell.js";

const OPPOSITE_SIDE = {
  top: "bottom",
  right: "left",
  bottom: "top",
  left: "right"
};

export function deriveBaseboardCandidates(plan, options = {}) {
  const rectangles = Array.isArray(plan?.entities?.rectangles) ? plan.entities.rectangles : [];
  const roomRectangles = rectangles.filter((rectangle) => rectangle?.kind !== "wallRect" && hasRectangleShape(rectangle));
  const wallRectangles = rectangles.filter((rectangle) => rectangle?.kind === "wallRect" && hasRectangleShape(rectangle));
  const touchToleranceWorld = positiveFinite(options.touchToleranceWorld, 1.5);
  const overlapToleranceWorld = nonNegativeFinite(options.overlapToleranceWorld, 1e-3);
  const metersPerWorldUnit = positiveFiniteOrNull(plan?.scale?.metersPerWorldUnit);

  const roomSides = buildRoomSides(roomRectangles, wallRectangles, {
    touchToleranceWorld,
    overlapToleranceWorld,
    metersPerWorldUnit
  });
  const supportedRoomSides = applyNeighborWallSupport(roomSides, touchToleranceWorld, overlapToleranceWorld);
  const sharedBoundaries = deriveSharedBoundaries(supportedRoomSides, touchToleranceWorld, overlapToleranceWorld);
  const sharedBoundaryRefsBySideId = indexSharedBoundaryRefsBySideId(sharedBoundaries);
  const sameRoomPruneIntervalsBySideId = collectSameRoomPruneIntervalsBySideId(sharedBoundaries);
  const unsupportedOpenSides = deriveUnsupportedOpenSides(
    supportedRoomSides,
    sharedBoundaryRefsBySideId,
    overlapToleranceWorld,
    metersPerWorldUnit
  );

  const candidateSegments = [];
  const segments = [];

  for (const side of supportedRoomSides) {
    if (!side.hasWallSupport) {
      continue;
    }

    const pruneIntervals = sameRoomPruneIntervalsBySideId.get(side.id) ?? [];
    for (let supportIndex = 0; supportIndex < side.supportIntervals.length; supportIndex += 1) {
      const supportInterval = side.supportIntervals[supportIndex];
      const supportSegmentId = side.supportIntervals.length > 1
        ? `${side.id}:support:${supportIndex + 1}`
        : side.id;
      const intervalWallSource = resolveSupportWallSource(side);
      const candidateSegment = createSegmentFromSideInterval(
        side,
        supportInterval.start,
        supportInterval.end,
        metersPerWorldUnit,
        supportSegmentId,
        intervalWallSource
      );
      if (candidateSegment) {
        candidateSegments.push(candidateSegment);
      }

      const keptIntervals = subtractIntervals(
        supportInterval.start,
        supportInterval.end,
        pruneIntervals,
        overlapToleranceWorld
      );
      for (let pieceIndex = 0; pieceIndex < keptIntervals.length; pieceIndex += 1) {
        const interval = keptIntervals[pieceIndex];
        const keptSegment = createSegmentFromSideInterval(
          side,
          interval.start,
          interval.end,
          metersPerWorldUnit,
          keptIntervals.length > 1 ? `${supportSegmentId}:part:${pieceIndex + 1}` : supportSegmentId,
          intervalWallSource
        );
        if (keptSegment) {
          segments.push(keptSegment);
        }
      }
    }
  }

  const totalLengthWorld = sumSegmentLength(segments);
  const totalLengthMeters = metersPerWorldUnit ? totalLengthWorld * metersPerWorldUnit : null;
  const candidateTotalLengthWorld = sumSegmentLength(candidateSegments);
  const candidateTotalLengthMeters = metersPerWorldUnit ? candidateTotalLengthWorld * metersPerWorldUnit : null;

  return {
    segments,
    segmentCount: segments.length,
    candidateSegments,
    candidateSegmentCount: candidateSegments.length,
    prunedSegmentCount: Math.max(0, candidateSegments.length - segments.length),
    roomRectangleCount: roomRectangles.length,
    wallRectangleCount: wallRectangles.length,
    totalLengthWorld,
    totalLengthMeters,
    candidateTotalLengthWorld,
    candidateTotalLengthMeters,
    prunedLengthWorld: Math.max(0, candidateTotalLengthWorld - totalLengthWorld),
    prunedLengthMeters:
      metersPerWorldUnit != null ? Math.max(0, candidateTotalLengthWorld - totalLengthWorld) * metersPerWorldUnit : null,
    sharedBoundaries,
    sharedBoundaryCount: sharedBoundaries.length,
    unsupportedOpenSides,
    unsupportedOpenSideCount: unsupportedOpenSides.length,
    touchToleranceWorld,
    overlapToleranceWorld
  };
}

function buildRoomSides(roomRectangles, wallRectangles, options) {
  const roomSides = [];
  const metersPerWorldUnit = options.metersPerWorldUnit;

  for (const rectangle of roomRectangles) {
    const wallCm = normalizeWallCm(rectangle.wallCm);
    const sideSpecs = getRectangleSideSpecs(rectangle);

    for (const sideSpec of sideSpecs) {
      const sideWallCm = wallCm[sideSpec.side];
      const sideWallWorld = wallCentimetersToWorld(sideWallCm, metersPerWorldUnit);
      const wallRectSupportIntervals = getWallRectSupportIntervals(
        rectangle,
        sideSpec.side,
        wallRectangles,
        options.touchToleranceWorld,
        options.overlapToleranceWorld
      );
      const wallRectContact = wallRectSupportIntervals.length > 0;
      const hasWallCmSupport = sideWallCm > 0;
      const supportIntervals = hasWallCmSupport
        ? [{ start: sideSpec.intervalStart, end: sideSpec.intervalEnd }]
        : wallRectSupportIntervals;
      const hasWallSupport = supportIntervals.length > 0;

      roomSides.push({
        id: `${rectangle.id}:${sideSpec.side}`,
        rectangleId: rectangle.id,
        roomId: typeof rectangle.roomId === "string" ? rectangle.roomId : null,
        side: sideSpec.side,
        axis: sideSpec.axis,
        intervalStart: sideSpec.intervalStart,
        intervalEnd: sideSpec.intervalEnd,
        coordinateInterior: sideSpec.coordinate,
        coordinateOuter: offsetCoordinateForSide(sideSpec.side, sideSpec.coordinate, sideWallWorld),
        wallSource: resolveWallSource(sideWallCm > 0, wallRectContact),
        hasWallCmSupport,
        hasWallRectSupport: wallRectContact,
        supportIntervals,
        hasWallSupport,
        lengthWorld: sideSpec.lengthWorld,
        x0: sideSpec.x0,
        y0: sideSpec.y0,
        x1: sideSpec.x1,
        y1: sideSpec.y1
      });
    }
  }

  return roomSides;
}

function applyNeighborWallSupport(roomSides, touchToleranceWorld, overlapToleranceWorld) {
  const directSides = roomSides.map((side) => ({
    ...side,
    supportIntervals: [...side.supportIntervals]
  }));
  const propagatedSides = directSides.map((side) => ({
    ...side,
    supportIntervals: [...side.supportIntervals],
    hasNeighborSupport: false
  }));

  for (let index = 0; index < propagatedSides.length; index += 1) {
    const side = propagatedSides[index];
    if (side.hasWallSupport) {
      continue;
    }

    const inheritedIntervals = [];
    for (const neighbor of directSides) {
      if (neighbor.rectangleId === side.rectangleId) {
        continue;
      }
      if (neighbor.axis !== side.axis) {
        continue;
      }
      if (OPPOSITE_SIDE[side.side] !== neighbor.side) {
        continue;
      }
      if (!neighbor.hasWallSupport) {
        continue;
      }
      if (!approximatelyEqual(side.coordinateInterior, neighbor.coordinateInterior, touchToleranceWorld)) {
        continue;
      }

      for (const neighborSupport of neighbor.supportIntervals) {
        const overlap = makeInterval(
          Math.max(side.intervalStart, neighborSupport.start),
          Math.min(side.intervalEnd, neighborSupport.end),
          overlapToleranceWorld
        );
        if (overlap) {
          inheritedIntervals.push(overlap);
        }
      }
    }

    const mergedInherited = mergeIntervals(inheritedIntervals, overlapToleranceWorld);
    if (mergedInherited.length === 0) {
      continue;
    }

    side.supportIntervals = mergedInherited;
    side.hasWallSupport = true;
    side.hasNeighborSupport = true;
    side.wallSource = "neighborWall";
  }

  return propagatedSides;
}

function getRectangleSideSpecs(rectangle) {
  return [
    {
      side: "top",
      axis: "horizontal",
      x0: rectangle.x,
      y0: rectangle.y,
      x1: rectangle.x + rectangle.w,
      y1: rectangle.y,
      coordinate: rectangle.y,
      intervalStart: rectangle.x,
      intervalEnd: rectangle.x + rectangle.w,
      lengthWorld: rectangle.w
    },
    {
      side: "right",
      axis: "vertical",
      x0: rectangle.x + rectangle.w,
      y0: rectangle.y,
      x1: rectangle.x + rectangle.w,
      y1: rectangle.y + rectangle.h,
      coordinate: rectangle.x + rectangle.w,
      intervalStart: rectangle.y,
      intervalEnd: rectangle.y + rectangle.h,
      lengthWorld: rectangle.h
    },
    {
      side: "bottom",
      axis: "horizontal",
      x0: rectangle.x,
      y0: rectangle.y + rectangle.h,
      x1: rectangle.x + rectangle.w,
      y1: rectangle.y + rectangle.h,
      coordinate: rectangle.y + rectangle.h,
      intervalStart: rectangle.x,
      intervalEnd: rectangle.x + rectangle.w,
      lengthWorld: rectangle.w
    },
    {
      side: "left",
      axis: "vertical",
      x0: rectangle.x,
      y0: rectangle.y,
      x1: rectangle.x,
      y1: rectangle.y + rectangle.h,
      coordinate: rectangle.x,
      intervalStart: rectangle.y,
      intervalEnd: rectangle.y + rectangle.h,
      lengthWorld: rectangle.h
    }
  ];
}

function deriveSharedBoundaries(roomSides, touchToleranceWorld, overlapToleranceWorld) {
  const boundaries = [];

  for (let index = 0; index < roomSides.length; index += 1) {
    const sideA = roomSides[index];
    for (let otherIndex = index + 1; otherIndex < roomSides.length; otherIndex += 1) {
      const sideB = roomSides[otherIndex];

      if (sideA.rectangleId === sideB.rectangleId) {
        continue;
      }
      if (sideA.axis !== sideB.axis) {
        continue;
      }
      if (OPPOSITE_SIDE[sideA.side] !== sideB.side) {
        continue;
      }
      if (!approximatelyEqual(sideA.coordinateOuter, sideB.coordinateOuter, touchToleranceWorld)) {
        continue;
      }

      const overlapStart = Math.max(sideA.intervalStart, sideB.intervalStart);
      const overlapEnd = Math.min(sideA.intervalEnd, sideB.intervalEnd);
      const overlapLengthWorld = overlapEnd - overlapStart;
      if (!(overlapLengthWorld > overlapToleranceWorld)) {
        continue;
      }

      boundaries.push(
        createSharedBoundary(sideA, sideB, overlapStart, overlapEnd, overlapLengthWorld, overlapToleranceWorld)
      );
    }
  }

  return boundaries;
}

function createSharedBoundary(sideA, sideB, overlapStart, overlapEnd, overlapLengthWorld, overlapToleranceWorld) {
  const coordinate = (sideA.coordinateOuter + sideB.coordinateOuter) / 2;
  const sameRoom = sideA.roomId != null && sideA.roomId === sideB.roomId;
  const sideASupportsOverlap = doesSideSupportInterval(sideA, overlapStart, overlapEnd, overlapToleranceWorld);
  const sideBSupportsOverlap = doesSideSupportInterval(sideB, overlapStart, overlapEnd, overlapToleranceWorld);
  const geometry =
    sideA.axis === "horizontal"
      ? {
          x0: overlapStart,
          y0: coordinate,
          x1: overlapEnd,
          y1: coordinate
        }
      : {
          x0: coordinate,
          y0: overlapStart,
          x1: coordinate,
          y1: overlapEnd
        };

  return {
    id: `${sideA.id}|${sideB.id}|${overlapStart.toFixed(3)}|${overlapEnd.toFixed(3)}`,
    axis: sideA.axis,
    sameRoom,
    overlapStart,
    overlapEnd,
    overlapLengthWorld,
    ...geometry,
    a: {
      sideId: sideA.id,
      rectangleId: sideA.rectangleId,
      roomId: sideA.roomId,
      side: sideA.side,
      hasWallSupport: sideA.hasWallSupport,
      supportsOverlap: sideASupportsOverlap
    },
    b: {
      sideId: sideB.id,
      rectangleId: sideB.rectangleId,
      roomId: sideB.roomId,
      side: sideB.side,
      hasWallSupport: sideB.hasWallSupport,
      supportsOverlap: sideBSupportsOverlap
    }
  };
}

function createSegmentFromSideInterval(
  side,
  intervalStart,
  intervalEnd,
  metersPerWorldUnit,
  idOverride = null,
  wallSourceOverride = null
) {
  const lengthWorld = Math.max(0, intervalEnd - intervalStart);
  if (lengthWorld <= 0) {
    return null;
  }

  const geometry =
    side.axis === "horizontal"
      ? {
          x0: intervalStart,
          y0: side.coordinateInterior,
          x1: intervalEnd,
          y1: side.coordinateInterior
        }
      : {
          x0: side.coordinateInterior,
          y0: intervalStart,
          x1: side.coordinateInterior,
          y1: intervalEnd
        };

  return {
    id: idOverride ?? side.id,
    sourceSideId: side.id,
    rectangleId: side.rectangleId,
    roomId: side.roomId,
    side: side.side,
    axis: side.axis,
    wallSource: wallSourceOverride ?? side.wallSource,
    lengthWorld,
    lengthMeters: metersPerWorldUnit ? lengthWorld * metersPerWorldUnit : null,
    ...geometry
  };
}

function indexSharedBoundaryRefsBySideId(sharedBoundaries) {
  const index = new Map();

  for (const boundary of sharedBoundaries) {
    appendBoundaryRef(index, boundary.a.sideId, boundary);
    appendBoundaryRef(index, boundary.b.sideId, boundary);
  }

  return index;
}

function appendBoundaryRef(index, sideId, boundary) {
  if (!index.has(sideId)) {
    index.set(sideId, []);
  }
  index.get(sideId).push(boundary);
}

function collectSameRoomPruneIntervalsBySideId(sharedBoundaries) {
  const intervalsBySideId = new Map();

  for (const boundary of sharedBoundaries) {
    if (!boundary.sameRoom) {
      continue;
    }
    appendPruneInterval(intervalsBySideId, boundary.a.sideId, boundary.overlapStart, boundary.overlapEnd);
    appendPruneInterval(intervalsBySideId, boundary.b.sideId, boundary.overlapStart, boundary.overlapEnd);
  }

  return intervalsBySideId;
}

function appendPruneInterval(intervalsBySideId, sideId, start, end) {
  if (!intervalsBySideId.has(sideId)) {
    intervalsBySideId.set(sideId, []);
  }
  intervalsBySideId.get(sideId).push({ start, end });
}

function deriveUnsupportedOpenSides(roomSides, sharedBoundaryRefsBySideId, overlapToleranceWorld, metersPerWorldUnit) {
  const openSides = [];

  for (const side of roomSides) {
    const coverageIntervals = [...side.supportIntervals];
    const boundaries = sharedBoundaryRefsBySideId.get(side.id) ?? [];
    for (const boundary of boundaries) {
      const neighbor = boundary.a.sideId === side.id ? boundary.b : boundary.a;
      if (boundary.sameRoom || neighbor.supportsOverlap) {
        coverageIntervals.push({
          start: boundary.overlapStart,
          end: boundary.overlapEnd
        });
      }
    }

    const uncoveredIntervals = subtractIntervals(
      side.intervalStart,
      side.intervalEnd,
      coverageIntervals,
      overlapToleranceWorld
    );
    for (let intervalIndex = 0; intervalIndex < uncoveredIntervals.length; intervalIndex += 1) {
      const interval = uncoveredIntervals[intervalIndex];
      const segment = createOpenSideSegment(
        side,
        interval.start,
        interval.end,
        metersPerWorldUnit,
        uncoveredIntervals.length > 1 ? `${side.id}:open:${intervalIndex + 1}` : side.id
      );
      if (segment) {
        openSides.push(segment);
      }
    }
  }

  return openSides;
}

function subtractIntervals(start, end, intervals, overlapToleranceWorld) {
  if (!(end > start)) {
    return [];
  }
  if (!Array.isArray(intervals) || intervals.length === 0) {
    return [{ start, end }];
  }

  const normalized = [];
  for (const interval of intervals) {
    if (!interval || !Number.isFinite(interval.start) || !Number.isFinite(interval.end)) {
      continue;
    }
    const clampedStart = clamp(interval.start, start, end);
    const clampedEnd = clamp(interval.end, start, end);
    if (!(clampedEnd - clampedStart > overlapToleranceWorld)) {
      continue;
    }
    normalized.push({ start: clampedStart, end: clampedEnd });
  }

  if (normalized.length === 0) {
    return [{ start, end }];
  }

  normalized.sort((a, b) => a.start - b.start || a.end - b.end);
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

  const remainder = [];
  let cursor = start;
  for (const interval of merged) {
    if (interval.start > cursor + overlapToleranceWorld) {
      remainder.push({ start: cursor, end: interval.start });
    }
    cursor = Math.max(cursor, interval.end);
  }
  if (end > cursor + overlapToleranceWorld) {
    remainder.push({ start: cursor, end });
  }

  return remainder.filter((interval) => interval.end - interval.start > overlapToleranceWorld);
}

function getWallRectSupportIntervals(roomRectangle, side, wallRectangles, touchToleranceWorld, overlapToleranceWorld) {
  const intervals = [];

  for (const wallRectangle of wallRectangles) {
    const interval = getWallRectSupportIntervalOnSide(
      roomRectangle,
      side,
      wallRectangle,
      touchToleranceWorld,
      overlapToleranceWorld
    );
    if (interval) {
      intervals.push(interval);
    }
  }

  return mergeIntervals(intervals, overlapToleranceWorld);
}

function getWallRectSupportIntervalOnSide(roomRectangle, side, wallRectangle, touchToleranceWorld, overlapToleranceWorld) {
  if (side === "top") {
    if (!approximatelyEqual(wallRectangle.y + wallRectangle.h, roomRectangle.y, touchToleranceWorld)) {
      return null;
    }
    return makeInterval(
      Math.max(roomRectangle.x, wallRectangle.x),
      Math.min(roomRectangle.x + roomRectangle.w, wallRectangle.x + wallRectangle.w),
      overlapToleranceWorld
    );
  }

  if (side === "right") {
    if (!approximatelyEqual(wallRectangle.x, roomRectangle.x + roomRectangle.w, touchToleranceWorld)) {
      return null;
    }
    return makeInterval(
      Math.max(roomRectangle.y, wallRectangle.y),
      Math.min(roomRectangle.y + roomRectangle.h, wallRectangle.y + wallRectangle.h),
      overlapToleranceWorld
    );
  }

  if (side === "bottom") {
    if (!approximatelyEqual(wallRectangle.y, roomRectangle.y + roomRectangle.h, touchToleranceWorld)) {
      return null;
    }
    return makeInterval(
      Math.max(roomRectangle.x, wallRectangle.x),
      Math.min(roomRectangle.x + roomRectangle.w, wallRectangle.x + wallRectangle.w),
      overlapToleranceWorld
    );
  }

  if (side === "left") {
    if (!approximatelyEqual(wallRectangle.x + wallRectangle.w, roomRectangle.x, touchToleranceWorld)) {
      return null;
    }
    return makeInterval(
      Math.max(roomRectangle.y, wallRectangle.y),
      Math.min(roomRectangle.y + roomRectangle.h, wallRectangle.y + wallRectangle.h),
      overlapToleranceWorld
    );
  }

  return null;
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

function doesSideSupportInterval(side, intervalStart, intervalEnd, overlapToleranceWorld) {
  if (!side?.supportIntervals || side.supportIntervals.length === 0) {
    return false;
  }
  for (const support of side.supportIntervals) {
    if (intervalOverlapLength(support.start, support.end, intervalStart, intervalEnd) > overlapToleranceWorld) {
      return true;
    }
  }
  return false;
}

function createOpenSideSegment(side, intervalStart, intervalEnd, metersPerWorldUnit, idOverride = null) {
  const lengthWorld = Math.max(0, intervalEnd - intervalStart);
  if (lengthWorld <= 0) {
    return null;
  }

  const geometry =
    side.axis === "horizontal"
      ? {
          x0: intervalStart,
          y0: side.coordinateInterior,
          x1: intervalEnd,
          y1: side.coordinateInterior
        }
      : {
          x0: side.coordinateInterior,
          y0: intervalStart,
          x1: side.coordinateInterior,
          y1: intervalEnd
        };

  return {
    id: idOverride ?? side.id,
    rectangleId: side.rectangleId,
    roomId: side.roomId,
    side: side.side,
    axis: side.axis,
    lengthWorld,
    lengthMeters: metersPerWorldUnit ? lengthWorld * metersPerWorldUnit : null,
    ...geometry
  };
}

function resolveWallSource(hasWallCm, hasWallRectContact) {
  if (hasWallCm && hasWallRectContact) {
    return "wallCm+wallRect";
  }
  if (hasWallCm) {
    return "wallCm";
  }
  if (hasWallRectContact) {
    return "wallRect";
  }
  return "none";
}

function resolveSupportWallSource(side) {
  if (side.hasWallCmSupport && side.hasWallRectSupport) {
    return "wallCm+wallRect";
  }
  if (side.hasWallCmSupport) {
    return "wallCm";
  }
  if (side.hasWallRectSupport) {
    return "wallRect";
  }
  if (side.hasNeighborSupport) {
    return "neighborWall";
  }
  return side.wallSource ?? "none";
}

function offsetCoordinateForSide(side, coordinate, wallWorld) {
  if (side === "top" || side === "left") {
    return coordinate - wallWorld;
  }
  if (side === "right" || side === "bottom") {
    return coordinate + wallWorld;
  }
  return coordinate;
}

function sumSegmentLength(segments) {
  return segments.reduce((sum, segment) => sum + (segment?.lengthWorld ?? 0), 0);
}

function hasRectangleShape(value) {
  return (
    value != null &&
    Number.isFinite(value.x) &&
    Number.isFinite(value.y) &&
    Number.isFinite(value.w) &&
    Number.isFinite(value.h) &&
    value.w > 0 &&
    value.h > 0
  );
}

function makeInterval(start, end, overlapToleranceWorld) {
  if (!Number.isFinite(start) || !Number.isFinite(end)) {
    return null;
  }
  if (end - start <= overlapToleranceWorld) {
    return null;
  }
  return { start, end };
}

function intervalOverlapLength(a0, a1, b0, b1) {
  return Math.max(0, Math.min(a1, b1) - Math.max(a0, b0));
}

function approximatelyEqual(a, b, epsilon) {
  return Math.abs(a - b) <= epsilon;
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function positiveFinite(value, fallback) {
  return Number.isFinite(value) && value > 0 ? value : fallback;
}

function nonNegativeFinite(value, fallback) {
  return Number.isFinite(value) && value >= 0 ? value : fallback;
}

function positiveFiniteOrNull(value) {
  return Number.isFinite(value) && value > 0 ? value : null;
}
