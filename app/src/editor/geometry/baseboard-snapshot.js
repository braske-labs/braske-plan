export const BASEBOARD_ALGO_VERSION = "baseboard-v1-room-wall-contact";

export function deriveBaseboardExportSnapshot(baseboard, options = {}) {
  const computedAt = typeof options.computedAt === "string" && options.computedAt
    ? options.computedAt
    : new Date().toISOString();
  const excludedRoomTypes = Array.isArray(baseboard?.excludedRoomTypes)
    ? baseboard.excludedRoomTypes
      .filter((roomType) => typeof roomType === "string" && roomType)
    : [];

  return {
    algoVersion: BASEBOARD_ALGO_VERSION,
    computedAt,
    excludedRoomTypes,
    counts: {
      candidateSegmentCount: toFiniteOrZero(baseboard?.candidateSegmentCount),
      rawSegmentCount: toFiniteOrZero(baseboard?.rawSegmentCount ?? baseboard?.segmentCount),
      countedSegmentCount: toFiniteOrZero(baseboard?.segmentCount),
      excludedSegmentCount: toFiniteOrZero(baseboard?.excludedSegmentCount),
      prunedSegmentCount: toFiniteOrZero(baseboard?.prunedSegmentCount),
      sharedBoundaryCount: toFiniteOrZero(baseboard?.sharedBoundaryCount),
      unsupportedOpenSideCount: toFiniteOrZero(baseboard?.unsupportedOpenSideCount)
    },
    lengths: {
      candidate: deriveLengthShape(baseboard, "candidateTotalLengthWorld", "candidateTotalLengthMeters"),
      raw: deriveLengthShape(baseboard, "rawTotalLengthWorld", "rawTotalLengthMeters"),
      counted: deriveLengthShape(baseboard, "totalLengthWorld", "totalLengthMeters"),
      excluded: deriveLengthShape(baseboard, "excludedLengthWorld", "excludedLengthMeters"),
      pruned: deriveLengthShape(baseboard, "prunedLengthWorld", "prunedLengthMeters")
    },
    segments: {
      candidates: normalizeSegments(baseboard?.candidateSegments),
      raw: normalizeSegments(baseboard?.rawSegments ?? baseboard?.segments),
      counted: normalizeSegments(baseboard?.segments),
      excluded: normalizeSegments(baseboard?.excludedSegments),
      unsupportedOpenSides: normalizeSegments(baseboard?.unsupportedOpenSides)
    },
    sharedBoundaries: normalizeSharedBoundaries(baseboard?.sharedBoundaries)
  };
}

function normalizeSegments(rawSegments) {
  if (!Array.isArray(rawSegments)) {
    return [];
  }
  return rawSegments
    .filter((segment) => segment && typeof segment === "object")
    .map((segment) => ({
      id: typeof segment.id === "string" ? segment.id : null,
      sourceSideId: typeof segment.sourceSideId === "string" ? segment.sourceSideId : null,
      rectangleId: typeof segment.rectangleId === "string" ? segment.rectangleId : null,
      roomId: typeof segment.roomId === "string" ? segment.roomId : null,
      side: normalizeSide(segment.side),
      axis: normalizeAxis(segment.axis),
      wallSource: typeof segment.wallSource === "string" ? segment.wallSource : null,
      x0: toFiniteOrNull(segment.x0),
      y0: toFiniteOrNull(segment.y0),
      x1: toFiniteOrNull(segment.x1),
      y1: toFiniteOrNull(segment.y1),
      lengthWorld: toFiniteOrNull(segment.lengthWorld),
      lengthMeters: toFiniteOrNull(segment.lengthMeters)
    }));
}

function normalizeSharedBoundaries(rawBoundaries) {
  if (!Array.isArray(rawBoundaries)) {
    return [];
  }
  return rawBoundaries
    .filter((boundary) => boundary && typeof boundary === "object")
    .map((boundary) => ({
      id: typeof boundary.id === "string" ? boundary.id : null,
      axis: normalizeAxis(boundary.axis),
      sameRoom: Boolean(boundary.sameRoom),
      overlapStart: toFiniteOrNull(boundary.overlapStart),
      overlapEnd: toFiniteOrNull(boundary.overlapEnd),
      overlapLengthWorld: toFiniteOrNull(boundary.overlapLengthWorld),
      x0: toFiniteOrNull(boundary.x0),
      y0: toFiniteOrNull(boundary.y0),
      x1: toFiniteOrNull(boundary.x1),
      y1: toFiniteOrNull(boundary.y1),
      a: normalizeBoundarySide(boundary.a),
      b: normalizeBoundarySide(boundary.b)
    }));
}

function normalizeBoundarySide(rawSide) {
  if (!rawSide || typeof rawSide !== "object") {
    return null;
  }
  return {
    sideId: typeof rawSide.sideId === "string" ? rawSide.sideId : null,
    rectangleId: typeof rawSide.rectangleId === "string" ? rawSide.rectangleId : null,
    roomId: typeof rawSide.roomId === "string" ? rawSide.roomId : null,
    side: normalizeSide(rawSide.side),
    hasWallSupport: Boolean(rawSide.hasWallSupport),
    supportsOverlap: Boolean(rawSide.supportsOverlap)
  };
}

function deriveLengthShape(baseboard, worldKey, metersKey) {
  return {
    world: toFiniteOrNull(baseboard?.[worldKey]),
    meters: toFiniteOrNull(baseboard?.[metersKey])
  };
}

function normalizeSide(side) {
  if (side === "top" || side === "right" || side === "bottom" || side === "left") {
    return side;
  }
  return null;
}

function normalizeAxis(axis) {
  if (axis === "horizontal" || axis === "vertical") {
    return axis;
  }
  return null;
}

function toFiniteOrZero(value) {
  return Number.isFinite(value) ? value : 0;
}

function toFiniteOrNull(value) {
  return Number.isFinite(value) ? value : null;
}
