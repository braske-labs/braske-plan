const CENTIMETERS_PER_METER = 100;
const DEFAULT_METERS_PER_WORLD_UNIT = 0.02;

export function resolveMetersPerWorldUnit(metersPerWorldUnit, options = {}) {
  if (Number.isFinite(metersPerWorldUnit) && metersPerWorldUnit > 0) {
    return metersPerWorldUnit;
  }

  const fallback = options.defaultMetersPerWorldUnit;
  if (Number.isFinite(fallback) && fallback > 0) {
    return fallback;
  }

  return DEFAULT_METERS_PER_WORLD_UNIT;
}

export function normalizeWallCm(rawWallCm) {
  const wallCm = rawWallCm && typeof rawWallCm === "object" ? rawWallCm : {};
  return {
    top: normalizeNonNegative(wallCm.top),
    right: normalizeNonNegative(wallCm.right),
    bottom: normalizeNonNegative(wallCm.bottom),
    left: normalizeNonNegative(wallCm.left)
  };
}

export function wallCentimetersToWorld(cm, metersPerWorldUnit, options = {}) {
  const sideCm = normalizeNonNegative(cm);
  const resolvedMetersPerWorldUnit = resolveMetersPerWorldUnit(metersPerWorldUnit, options);
  return (sideCm / CENTIMETERS_PER_METER) / resolvedMetersPerWorldUnit;
}

export function getRectangleWallWorld(rectangle, metersPerWorldUnit, options = {}) {
  const wallCm = normalizeWallCm(rectangle?.wallCm);
  return {
    top: wallCentimetersToWorld(wallCm.top, metersPerWorldUnit, options),
    right: wallCentimetersToWorld(wallCm.right, metersPerWorldUnit, options),
    bottom: wallCentimetersToWorld(wallCm.bottom, metersPerWorldUnit, options),
    left: wallCentimetersToWorld(wallCm.left, metersPerWorldUnit, options)
  };
}

export function getRectangleOuterRect(rectangle, metersPerWorldUnit, options = {}) {
  if (!isRectangle(rectangle)) {
    return null;
  }
  const wallWorld = getRectangleWallWorld(rectangle, metersPerWorldUnit, options);
  return interiorRectToOuterRect(rectangle, wallWorld);
}

export function interiorRectToOuterRect(interiorRect, wallWorld) {
  if (!isRectangle(interiorRect) || !isWallWorld(wallWorld)) {
    return null;
  }
  return {
    x: interiorRect.x - wallWorld.left,
    y: interiorRect.y - wallWorld.top,
    w: interiorRect.w + wallWorld.left + wallWorld.right,
    h: interiorRect.h + wallWorld.top + wallWorld.bottom
  };
}

export function outerRectToInteriorRect(outerRect, wallWorld) {
  if (!isRectangle(outerRect) || !isWallWorld(wallWorld)) {
    return null;
  }
  const w = outerRect.w - wallWorld.left - wallWorld.right;
  const h = outerRect.h - wallWorld.top - wallWorld.bottom;
  if (!(w > 0) || !(h > 0)) {
    return null;
  }

  return {
    x: outerRect.x + wallWorld.left,
    y: outerRect.y + wallWorld.top,
    w,
    h
  };
}

export function deriveRectangleShellGeometry(rectangle, metersPerWorldUnit, options = {}) {
  if (!isRectangle(rectangle)) {
    return null;
  }

  const wallCm = normalizeWallCm(rectangle.wallCm);
  const wallWorld = getRectangleWallWorld(rectangle, metersPerWorldUnit, options);
  const outerRect = interiorRectToOuterRect(rectangle, wallWorld);
  if (!outerRect) {
    return null;
  }

  const wallBands = {
    top: wallWorld.top > 0
      ? { x: outerRect.x, y: outerRect.y, w: outerRect.w, h: wallWorld.top }
      : null,
    right: wallWorld.right > 0
      ? { x: rectangle.x + rectangle.w, y: outerRect.y, w: wallWorld.right, h: outerRect.h }
      : null,
    bottom: wallWorld.bottom > 0
      ? { x: outerRect.x, y: rectangle.y + rectangle.h, w: outerRect.w, h: wallWorld.bottom }
      : null,
    left: wallWorld.left > 0
      ? { x: outerRect.x, y: outerRect.y, w: wallWorld.left, h: outerRect.h }
      : null
  };

  return {
    interiorRect: {
      x: rectangle.x,
      y: rectangle.y,
      w: rectangle.w,
      h: rectangle.h
    },
    wallCm,
    wallWorld,
    outerRect,
    wallBands
  };
}

function normalizeNonNegative(value) {
  return Number.isFinite(value) && value >= 0 ? value : 0;
}

function isWallWorld(value) {
  return (
    value != null &&
    Number.isFinite(value.top) &&
    Number.isFinite(value.right) &&
    Number.isFinite(value.bottom) &&
    Number.isFinite(value.left) &&
    value.top >= 0 &&
    value.right >= 0 &&
    value.bottom >= 0 &&
    value.left >= 0
  );
}

function isRectangle(value) {
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
