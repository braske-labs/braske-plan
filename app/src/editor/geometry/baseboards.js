import { deriveRoomWallDecomposition } from "./room-wall-topology.js";

const OPPOSITE_SIDE = {
  top: "bottom",
  right: "left",
  bottom: "top",
  left: "right"
};
const DEFAULT_EXCLUDED_ROOM_TYPES = Object.freeze(["bathroom", "toilet"]);

export { deriveRoomWallDecomposition } from "./room-wall-topology.js";

export function deriveBaseboardCandidates(plan, options = {}) {
  const topology = deriveRoomWallContactModel(plan, options);
  const {
    roomSides,
    sharedBoundaries,
    unsupportedOpenSides,
    roomRectangleCount,
    wallRectangleCount,
    metersPerWorldUnit,
    touchToleranceWorld,
    overlapToleranceWorld
  } = topology;
  const sameRoomPruneIntervalsBySideId = collectSameRoomPruneIntervalsBySideId(sharedBoundaries);
  const crossRoomSupportIntervalsBySideId = collectCrossRoomSupportIntervalsBySideId(
    sharedBoundaries,
    overlapToleranceWorld
  );
  const roomSideById = new Map(roomSides.map((side) => [side.id, side]));
  const candidateSegments = [];
  const segments = [];

  for (const side of roomSides) {
    const fallbackSupportIntervals = crossRoomSupportIntervalsBySideId.get(side.id) ?? [];
    const supportIntervals = side.hasWallSupport ? side.supportIntervals : fallbackSupportIntervals;
    if (supportIntervals.length === 0) {
      continue;
    }

    const pruneIntervals = sameRoomPruneIntervalsBySideId.get(side.id) ?? [];
    for (let supportIndex = 0; supportIndex < supportIntervals.length; supportIndex += 1) {
      const supportInterval = supportIntervals[supportIndex];
      const supportSegmentId = supportIntervals.length > 1
        ? `${side.id}:support:${supportIndex + 1}`
        : side.id;
      const intervalWallSource = side.hasWallSupport ? resolveSupportWallSource(side) : "neighborWall";
      const candidateSegment = createRoomSideSegment(
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
        const keptSegment = createRoomSideSegment(
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

  appendMirroredCrossRoomSegments({
    sharedBoundaries,
    roomSideById,
    segments,
    candidateSegments,
    metersPerWorldUnit,
    overlapToleranceWorld
  });

  const rawSegments = segments.slice();
  const { countedSegments, excludedSegments, excludedRoomTypes } = splitSegmentsByRoomTypeExclusion(
    rawSegments,
    plan,
    options.excludedRoomTypes
  );

  const totalLengthWorld = sumSegmentLength(countedSegments);
  const totalLengthMeters = metersPerWorldUnit ? totalLengthWorld * metersPerWorldUnit : null;
  const rawTotalLengthWorld = sumSegmentLength(rawSegments);
  const rawTotalLengthMeters = metersPerWorldUnit ? rawTotalLengthWorld * metersPerWorldUnit : null;
  const excludedLengthWorld = sumSegmentLength(excludedSegments);
  const excludedLengthMeters = metersPerWorldUnit != null ? excludedLengthWorld * metersPerWorldUnit : null;
  const candidateTotalLengthWorld = sumSegmentLength(candidateSegments);
  const candidateTotalLengthMeters = metersPerWorldUnit ? candidateTotalLengthWorld * metersPerWorldUnit : null;

  return {
    segments: countedSegments,
    segmentCount: countedSegments.length,
    rawSegments,
    rawSegmentCount: rawSegments.length,
    excludedSegments,
    excludedSegmentCount: excludedSegments.length,
    excludedRoomTypes: Array.from(excludedRoomTypes),
    candidateSegments,
    candidateSegmentCount: candidateSegments.length,
    prunedSegmentCount: Math.max(0, candidateSegments.length - rawSegments.length),
    roomRectangleCount,
    wallRectangleCount,
    totalLengthWorld,
    totalLengthMeters,
    rawTotalLengthWorld,
    rawTotalLengthMeters,
    excludedLengthWorld,
    excludedLengthMeters,
    candidateTotalLengthWorld,
    candidateTotalLengthMeters,
    prunedLengthWorld: Math.max(0, candidateTotalLengthWorld - rawTotalLengthWorld),
    prunedLengthMeters:
      metersPerWorldUnit != null ? Math.max(0, candidateTotalLengthWorld - rawTotalLengthWorld) * metersPerWorldUnit : null,
    sharedBoundaries,
    sharedBoundaryCount: sharedBoundaries.length,
    unsupportedOpenSides,
    unsupportedOpenSideCount: unsupportedOpenSides.length,
    touchToleranceWorld,
    overlapToleranceWorld
  };
}

function appendMirroredCrossRoomSegments({
  sharedBoundaries,
  roomSideById,
  segments,
  candidateSegments,
  metersPerWorldUnit,
  overlapToleranceWorld
}) {
  for (const boundary of sharedBoundaries) {
    if (boundary.sameRoom) {
      continue;
    }

    if (boundary.a.supportsOverlap && !boundary.b.supportsOverlap) {
      appendMirroredSegment(boundary.b.sideId, boundary, "a");
    }
    if (boundary.b.supportsOverlap && !boundary.a.supportsOverlap) {
      appendMirroredSegment(boundary.a.sideId, boundary, "b");
    }
  }

  function appendMirroredSegment(targetSideId, boundary, sourceLabel) {
    const targetSide = roomSideById.get(targetSideId);
    if (!targetSide) {
      return;
    }

    const segment = createRoomSideSegment(
      targetSide,
      boundary.overlapStart,
      boundary.overlapEnd,
      metersPerWorldUnit,
      `${targetSide.id}:mirror:${sourceLabel}`,
      "neighborWall"
    );
    if (!segment) {
      return;
    }
    if (containsEquivalentSegment(candidateSegments, segment, overlapToleranceWorld)) {
      return;
    }

    candidateSegments.push(segment);
    segments.push(segment);
  }
}

function containsEquivalentSegment(segments, candidate, overlapToleranceWorld) {
  for (const segment of segments) {
    if (segment.sourceSideId !== candidate.sourceSideId) {
      continue;
    }
    if (
      approximatelyEqual(segment.x0, candidate.x0, overlapToleranceWorld) &&
      approximatelyEqual(segment.y0, candidate.y0, overlapToleranceWorld) &&
      approximatelyEqual(segment.x1, candidate.x1, overlapToleranceWorld) &&
      approximatelyEqual(segment.y1, candidate.y1, overlapToleranceWorld)
    ) {
      return true;
    }
  }
  return false;
}

export function deriveRoomWallContactModel(plan, options = {}) {
  const decomposition = deriveRoomWallDecomposition(plan, options);
  const {
    roomSides: decomposedRoomSides,
    wallRectangles,
    roomRectangleCount,
    wallRectangleCount,
    metersPerWorldUnit,
    touchToleranceWorld,
    overlapToleranceWorld
  } = decomposition;

  const roomSidesWithDirectSupport = buildRoomSidesWithDirectSupport(
    decomposedRoomSides,
    wallRectangles,
    touchToleranceWorld,
    overlapToleranceWorld
  );
  const neighborSupportedSides = applyNeighborWallSupport(roomSidesWithDirectSupport, touchToleranceWorld, overlapToleranceWorld);
  const supportedRoomSides = applyBoundarySupportInheritance(
    neighborSupportedSides,
    touchToleranceWorld,
    overlapToleranceWorld
  );
  const sharedBoundaries = deriveSharedBoundaries(supportedRoomSides, touchToleranceWorld, overlapToleranceWorld);
  const sharedBoundaryRefsBySideId = indexSharedBoundaryRefsBySideId(sharedBoundaries);
  const unsupportedOpenSides = deriveUnsupportedOpenSides(
    supportedRoomSides,
    sharedBoundaryRefsBySideId,
    overlapToleranceWorld,
    metersPerWorldUnit
  );

  return {
    roomSides: supportedRoomSides,
    roomWallContacts: buildRoomWallContacts(supportedRoomSides, metersPerWorldUnit),
    sharedBoundaries,
    unsupportedOpenSides,
    roomRectangleCount,
    wallRectangleCount,
    metersPerWorldUnit,
    touchToleranceWorld,
    overlapToleranceWorld
  };
}

function buildRoomWallContacts(roomSides, metersPerWorldUnit) {
  const contacts = [];

  for (const side of roomSides) {
    if (!side.hasWallSupport) {
      continue;
    }
    const intervalWallSource = resolveSupportWallSource(side);
    for (let supportIndex = 0; supportIndex < side.supportIntervals.length; supportIndex += 1) {
      const supportInterval = side.supportIntervals[supportIndex];
      const contactId = side.supportIntervals.length > 1
        ? `${side.id}:support:${supportIndex + 1}`
        : side.id;
      const contactSegment = createRoomSideSegment(
        side,
        supportInterval.start,
        supportInterval.end,
        metersPerWorldUnit,
        contactId,
        intervalWallSource
      );
      if (contactSegment) {
        contacts.push(contactSegment);
      }
    }
  }

  return contacts;
}

function buildRoomSidesWithDirectSupport(roomSides, wallRectangles, touchToleranceWorld, overlapToleranceWorld) {
  return roomSides.map((side) => {
    const wallRectSupportIntervals = getWallRectSupportIntervals(
      side,
      wallRectangles,
      touchToleranceWorld,
      overlapToleranceWorld
    );
    const hasWallRectSupport = wallRectSupportIntervals.length > 0;
    const hasWallCmSupport = side.hasWallCm;
    const supportIntervals = hasWallCmSupport
      ? [{ start: side.intervalStart, end: side.intervalEnd }]
      : wallRectSupportIntervals;

    return {
      ...side,
      hasWallCmSupport,
      hasWallRectSupport,
      hasNeighborSupport: false,
      supportIntervals,
      hasWallSupport: supportIntervals.length > 0,
      wallSource: resolveWallSource(hasWallCmSupport, hasWallRectSupport)
    };
  });
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
      if (!touchesNeighborSupportedBoundary(side, neighbor, touchToleranceWorld)) {
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

function applyBoundarySupportInheritance(roomSides, touchToleranceWorld, overlapToleranceWorld) {
  const sidesById = new Map(
    roomSides.map((side) => [
      side.id,
      {
        ...side,
        supportIntervals: [...side.supportIntervals]
      }
    ])
  );

  const boundaries = deriveSharedBoundaries([...sidesById.values()], touchToleranceWorld, overlapToleranceWorld);
  for (const boundary of boundaries) {
    if (boundary.sameRoom) {
      continue;
    }
    inheritBoundarySupport(boundary.a.sideId, boundary.b.sideId, boundary);
    inheritBoundarySupport(boundary.b.sideId, boundary.a.sideId, boundary);
  }

  return [...sidesById.values()];

  function inheritBoundarySupport(targetSideId, sourceSideId, boundary) {
    const targetSide = sidesById.get(targetSideId);
    const sourceSide = sidesById.get(sourceSideId);
    if (!targetSide || !sourceSide) {
      return;
    }
    if (targetSide.hasWallSupport || !sourceSide.hasWallSupport) {
      return;
    }
    if (!doesSideSupportInterval(sourceSide, boundary.overlapStart, boundary.overlapEnd, overlapToleranceWorld)) {
      return;
    }

    const inheritedOverlap = makeInterval(boundary.overlapStart, boundary.overlapEnd, overlapToleranceWorld);
    if (!inheritedOverlap) {
      return;
    }

    targetSide.supportIntervals = mergeIntervals(
      [...targetSide.supportIntervals, inheritedOverlap],
      overlapToleranceWorld
    );
    targetSide.hasWallSupport = true;
    targetSide.hasNeighborSupport = true;
    targetSide.wallSource = "neighborWall";
  }
}

function touchesNeighborSupportedBoundary(side, neighbor, touchToleranceWorld) {
  if (
    neighbor.hasWallCmSupport &&
    isCoordinateWithinWallBand(
      side.coordinateInterior,
      neighbor.coordinateInterior,
      neighbor.coordinateOuter,
      touchToleranceWorld
    )
  ) {
    return true;
  }

  const neighborSupportCoordinates = getNeighborSupportCoordinates(neighbor);
  for (const coordinate of neighborSupportCoordinates) {
    if (approximatelyEqual(side.coordinateInterior, coordinate, touchToleranceWorld)) {
      return true;
    }
  }
  return false;
}

function getNeighborSupportCoordinates(side) {
  const coordinates = [];
  if (side.hasWallCmSupport) {
    coordinates.push(side.coordinateOuter);
  }
  if (side.hasWallRectSupport || !side.hasWallCmSupport) {
    coordinates.push(side.coordinateInterior);
  }
  return coordinates;
}

function isCoordinateWithinWallBand(coordinate, wallInteriorCoordinate, wallOuterCoordinate, tolerance) {
  if (
    !Number.isFinite(coordinate) ||
    !Number.isFinite(wallInteriorCoordinate) ||
    !Number.isFinite(wallOuterCoordinate)
  ) {
    return false;
  }
  const min = Math.min(wallInteriorCoordinate, wallOuterCoordinate) - tolerance;
  const max = Math.max(wallInteriorCoordinate, wallOuterCoordinate) + tolerance;
  return coordinate >= min && coordinate <= max;
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

function createRoomSideSegment(
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

function collectCrossRoomSupportIntervalsBySideId(sharedBoundaries, overlapToleranceWorld) {
  const intervalsBySideId = new Map();

  for (const boundary of sharedBoundaries) {
    if (boundary.sameRoom) {
      continue;
    }
    if (boundary.b.supportsOverlap) {
      appendPruneInterval(intervalsBySideId, boundary.a.sideId, boundary.overlapStart, boundary.overlapEnd);
    }
    if (boundary.a.supportsOverlap) {
      appendPruneInterval(intervalsBySideId, boundary.b.sideId, boundary.overlapStart, boundary.overlapEnd);
    }
  }

  for (const [sideId, intervals] of intervalsBySideId.entries()) {
    intervalsBySideId.set(sideId, mergeIntervals(intervals, overlapToleranceWorld));
  }

  return intervalsBySideId;
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

function getWallRectSupportIntervals(side, wallRectangles, touchToleranceWorld, overlapToleranceWorld) {
  const intervals = [];

  for (const wallRectangle of wallRectangles) {
    const interval = getWallRectSupportIntervalOnSide(
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

function getWallRectSupportIntervalOnSide(side, wallRectangle, touchToleranceWorld, overlapToleranceWorld) {
  if (side.side === "top") {
    if (!approximatelyEqual(wallRectangle.y + wallRectangle.h, side.coordinateInterior, touchToleranceWorld)) {
      return null;
    }
    return makeInterval(
      Math.max(side.intervalStart, wallRectangle.x),
      Math.min(side.intervalEnd, wallRectangle.x + wallRectangle.w),
      overlapToleranceWorld
    );
  }

  if (side.side === "right") {
    if (!approximatelyEqual(wallRectangle.x, side.coordinateInterior, touchToleranceWorld)) {
      return null;
    }
    return makeInterval(
      Math.max(side.intervalStart, wallRectangle.y),
      Math.min(side.intervalEnd, wallRectangle.y + wallRectangle.h),
      overlapToleranceWorld
    );
  }

  if (side.side === "bottom") {
    if (!approximatelyEqual(wallRectangle.y, side.coordinateInterior, touchToleranceWorld)) {
      return null;
    }
    return makeInterval(
      Math.max(side.intervalStart, wallRectangle.x),
      Math.min(side.intervalEnd, wallRectangle.x + wallRectangle.w),
      overlapToleranceWorld
    );
  }

  if (side.side === "left") {
    if (!approximatelyEqual(wallRectangle.x + wallRectangle.w, side.coordinateInterior, touchToleranceWorld)) {
      return null;
    }
    return makeInterval(
      Math.max(side.intervalStart, wallRectangle.y),
      Math.min(side.intervalEnd, wallRectangle.y + wallRectangle.h),
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

function resolveWallSource(hasWallCmSupport, hasWallRectSupport) {
  if (hasWallCmSupport && hasWallRectSupport) {
    return "wallCm+wallRect";
  }
  if (hasWallCmSupport) {
    return "wallCm";
  }
  if (hasWallRectSupport) {
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

function sumSegmentLength(segments) {
  return segments.reduce((sum, segment) => sum + (segment?.lengthWorld ?? 0), 0);
}

function splitSegmentsByRoomTypeExclusion(rawSegments, plan, excludedRoomTypesInput) {
  const excludedRoomTypes = normalizeExcludedRoomTypes(excludedRoomTypesInput);
  if (!Array.isArray(rawSegments) || rawSegments.length === 0) {
    return {
      countedSegments: [],
      excludedSegments: [],
      excludedRoomTypes
    };
  }
  if (excludedRoomTypes.size === 0) {
    return {
      countedSegments: [...rawSegments],
      excludedSegments: [],
      excludedRoomTypes
    };
  }

  const roomTypeById = buildRoomTypeById(plan);
  const countedSegments = [];
  const excludedSegments = [];

  for (const segment of rawSegments) {
    const roomType = deriveSegmentRoomType(segment, roomTypeById);
    if (excludedRoomTypes.has(roomType)) {
      excludedSegments.push(segment);
    } else {
      countedSegments.push(segment);
    }
  }

  return {
    countedSegments,
    excludedSegments,
    excludedRoomTypes
  };
}

function normalizeExcludedRoomTypes(excludedRoomTypesInput) {
  const source = Array.isArray(excludedRoomTypesInput)
    ? excludedRoomTypesInput
    : DEFAULT_EXCLUDED_ROOM_TYPES;
  const normalized = new Set();
  for (const roomType of source) {
    const normalizedType = normalizeRoomTypeToken(roomType);
    if (normalizedType) {
      normalized.add(normalizedType);
    }
  }
  return normalized;
}

function buildRoomTypeById(plan) {
  const rooms = Array.isArray(plan?.entities?.rooms) ? plan.entities.rooms : [];
  const roomTypeById = new Map();
  for (const room of rooms) {
    if (typeof room?.id !== "string" || !room.id) {
      continue;
    }
    const roomType = normalizeRoomTypeToken(room.roomType) ?? "generic";
    roomTypeById.set(room.id, roomType);
  }
  return roomTypeById;
}

function deriveSegmentRoomType(segment, roomTypeById) {
  const roomId = typeof segment?.roomId === "string" && segment.roomId
    ? segment.roomId
    : null;
  if (!roomId) {
    return "generic";
  }
  return roomTypeById.get(roomId) ?? "generic";
}

function normalizeRoomTypeToken(roomType) {
  if (typeof roomType !== "string") {
    return null;
  }
  const normalized = roomType.trim().toLowerCase().replaceAll("-", "_").replaceAll(/\s+/g, "_");
  return normalized || null;
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
