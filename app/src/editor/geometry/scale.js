export function distanceBetweenWorldPoints(pointA, pointB) {
  if (!isPoint(pointA) || !isPoint(pointB)) {
    return null;
  }

  const dx = pointB.x - pointA.x;
  const dy = pointB.y - pointA.y;
  return Math.hypot(dx, dy);
}

export function computeMetersPerWorldUnit(worldLength, meters) {
  if (!Number.isFinite(worldLength) || worldLength <= 0) {
    return null;
  }
  if (!Number.isFinite(meters) || meters <= 0) {
    return null;
  }
  return meters / worldLength;
}

export function computeMetersPerWorldUnitFromArea(worldArea, squareMeters) {
  if (!Number.isFinite(worldArea) || worldArea <= 0) {
    return null;
  }
  if (!Number.isFinite(squareMeters) || squareMeters <= 0) {
    return null;
  }
  return Math.sqrt(squareMeters / worldArea);
}

export function buildScaleCalibration(startPoint, endPoint, meters) {
  const worldLength = distanceBetweenWorldPoints(startPoint, endPoint);
  const metersPerWorldUnit = computeMetersPerWorldUnit(worldLength, meters);
  if (worldLength == null || metersPerWorldUnit == null) {
    return null;
  }

  return {
    referenceLine: {
      x0: startPoint.x,
      y0: startPoint.y,
      x1: endPoint.x,
      y1: endPoint.y,
      meters
    },
    worldLength,
    metersPerWorldUnit
  };
}

export function worldLengthToMeters(worldLength, metersPerWorldUnit) {
  if (!Number.isFinite(worldLength) || worldLength < 0) {
    return null;
  }
  if (!Number.isFinite(metersPerWorldUnit) || metersPerWorldUnit <= 0) {
    return null;
  }
  return worldLength * metersPerWorldUnit;
}

export function formatMetersAndCentimeters(meters, options = {}) {
  if (!Number.isFinite(meters) || meters < 0) {
    return null;
  }

  const metersDecimals = Number.isInteger(options.metersDecimals) ? options.metersDecimals : 2;
  const centimetersDecimals = Number.isInteger(options.centimetersDecimals) ? options.centimetersDecimals : 1;
  const centimeters = meters * 100;

  return `${meters.toFixed(metersDecimals)} m (${centimeters.toFixed(centimetersDecimals)} cm)`;
}

function isPoint(value) {
  return value != null && Number.isFinite(value.x) && Number.isFinite(value.y);
}
