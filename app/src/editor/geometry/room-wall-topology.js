import { deriveRectangleShellGeometry, normalizeWallCm, wallCentimetersToWorld } from "./wall-shell.js";

export function deriveRoomWallDecomposition(plan, options = {}) {
  const rectangles = Array.isArray(plan?.entities?.rectangles) ? plan.entities.rectangles : [];
  const roomRectangles = rectangles.filter((rectangle) => rectangle?.kind !== "wallRect" && hasRectangleShape(rectangle));
  const explicitWallRectangles = rectangles.filter((rectangle) => rectangle?.kind === "wallRect" && hasRectangleShape(rectangle));
  const touchToleranceWorld = positiveFinite(options.touchToleranceWorld, 1.5);
  const overlapToleranceWorld = nonNegativeFinite(options.overlapToleranceWorld, 1e-3);
  const metersPerWorldUnit = positiveFiniteOrNull(plan?.scale?.metersPerWorldUnit);
  const derivedWallRectangles = buildDerivedWallBandRectangles(roomRectangles, metersPerWorldUnit);
  const wallRectangles = [...explicitWallRectangles, ...derivedWallRectangles];
  const roomSides = buildRoomSides(roomRectangles, metersPerWorldUnit);

  return {
    roomRectangles,
    wallRectangles,
    roomSides,
    roomRectangleCount: roomRectangles.length,
    wallRectangleCount: explicitWallRectangles.length,
    derivedWallRectangleCount: derivedWallRectangles.length,
    metersPerWorldUnit,
    touchToleranceWorld,
    overlapToleranceWorld
  };
}

function buildDerivedWallBandRectangles(roomRectangles, metersPerWorldUnit) {
  const derived = [];

  for (const rectangle of roomRectangles) {
    const shell = deriveRectangleShellGeometry(rectangle, metersPerWorldUnit);
    const bands = shell?.wallBands;
    if (!bands) {
      continue;
    }
    appendDerivedBand(derived, rectangle, "top", bands.top);
    appendDerivedBand(derived, rectangle, "right", bands.right);
    appendDerivedBand(derived, rectangle, "bottom", bands.bottom);
    appendDerivedBand(derived, rectangle, "left", bands.left);
  }

  return derived;
}

function appendDerivedBand(derived, ownerRectangle, side, band) {
  if (!hasRectangleShape(band)) {
    return;
  }

  derived.push({
    id: `derived_wall_band:${ownerRectangle.id}:${side}`,
    kind: "wallRect",
    x: band.x,
    y: band.y,
    w: band.w,
    h: band.h,
    source: "derivedWallBand",
    ownerRectangleId: ownerRectangle.id,
    ownerRoomId: typeof ownerRectangle.roomId === "string" ? ownerRectangle.roomId : null,
    ownerSide: side
  });
}

function buildRoomSides(roomRectangles, metersPerWorldUnit) {
  const roomSides = [];

  for (const rectangle of roomRectangles) {
    const wallCm = normalizeWallCm(rectangle.wallCm);
    const sideSpecs = getRectangleSideSpecs(rectangle);

    for (const sideSpec of sideSpecs) {
      const sideWallCm = wallCm[sideSpec.side];
      const sideWallWorld = wallCentimetersToWorld(sideWallCm, metersPerWorldUnit);
      const hasWallCmSupport = sideWallCm > 0;

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
        wallCm: sideWallCm,
        hasWallCm: hasWallCmSupport,
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

function offsetCoordinateForSide(side, coordinate, wallWorld) {
  if (side === "top" || side === "left") {
    return coordinate - wallWorld;
  }
  if (side === "right" || side === "bottom") {
    return coordinate + wallWorld;
  }
  return coordinate;
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

function positiveFinite(value, fallback) {
  return Number.isFinite(value) && value > 0 ? value : fallback;
}

function nonNegativeFinite(value, fallback) {
  return Number.isFinite(value) && value >= 0 ? value : fallback;
}

function positiveFiniteOrNull(value) {
  return Number.isFinite(value) && value > 0 ? value : null;
}
