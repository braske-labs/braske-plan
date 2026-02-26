export function buildRectangleSnapTargets(rectangles, options = {}) {
  const excludeRectangleId = options.excludeRectangleId ?? null;
  const xTargets = [];
  const yTargets = [];

  for (const rectangle of rectangles) {
    if (!rectangle || rectangle.id === excludeRectangleId) {
      continue;
    }

    const xMin = rectangle.x;
    const xMax = rectangle.x + rectangle.w;
    const yMin = rectangle.y;
    const yMax = rectangle.y + rectangle.h;

    xTargets.push({ value: xMin, rectangleId: rectangle.id, edge: "left" });
    xTargets.push({ value: xMax, rectangleId: rectangle.id, edge: "right" });
    yTargets.push({ value: yMin, rectangleId: rectangle.id, edge: "top" });
    yTargets.push({ value: yMax, rectangleId: rectangle.id, edge: "bottom" });
  }

  return { xTargets, yTargets };
}

export function generateAxisSnapCandidates(anchorValues, targetValues, toleranceWorld, options = {}) {
  if (!Array.isArray(anchorValues) || !Array.isArray(targetValues) || !(toleranceWorld >= 0)) {
    return [];
  }

  const pairFilter = typeof options.pairFilter === "function" ? options.pairFilter : null;
  const candidates = [];
  for (const anchor of anchorValues) {
    if (!anchor || !Number.isFinite(anchor.value)) {
      continue;
    }

    for (const target of targetValues) {
      if (!target || !Number.isFinite(target.value)) {
        continue;
      }
      if (pairFilter && !pairFilter(anchor, target)) {
        continue;
      }

      const delta = target.value - anchor.value;
      if (Math.abs(delta) > toleranceWorld) {
        continue;
      }

      candidates.push({
        delta,
        distance: Math.abs(delta),
        anchor,
        target
      });
    }
  }

  return candidates;
}

export function chooseBestAxisSnapCandidate(candidates) {
  if (!Array.isArray(candidates) || candidates.length === 0) {
    return null;
  }

  let best = candidates[0];
  for (let index = 1; index < candidates.length; index += 1) {
    const candidate = candidates[index];
    if (candidate.distance < best.distance) {
      best = candidate;
      continue;
    }
    if (candidate.distance === best.distance && Math.abs(candidate.delta) < Math.abs(best.delta)) {
      best = candidate;
    }
  }

  return best;
}

export function snapDraggedRectangle(proposedRectangle, rectangles, options = {}) {
  const toleranceWorld = options.toleranceWorld ?? 0;
  if (!isRectangleShape(proposedRectangle) || toleranceWorld <= 0) {
    return {
      rectangle: proposedRectangle,
      snap: { x: null, y: null }
    };
  }

  const { xTargets, yTargets } = buildRectangleSnapTargets(rectangles, {
    excludeRectangleId: options.excludeRectangleId ?? null
  });
  const rectanglesById = indexRectanglesById(rectangles);

  const xAnchors = [
    { name: "left", value: proposedRectangle.x },
    { name: "right", value: proposedRectangle.x + proposedRectangle.w }
  ];
  const yAnchors = [
    { name: "top", value: proposedRectangle.y },
    { name: "bottom", value: proposedRectangle.y + proposedRectangle.h }
  ];

  const xDragCandidates = generateAxisSnapCandidates(xAnchors, xTargets, toleranceWorld, {
    pairFilter: (anchor, target) =>
      isOppositeEdgePair("x", anchor.name, target.edge) ||
      isSameEdgePair("x", anchor.name, target.edge)
  });
  const yDragCandidates = generateAxisSnapCandidates(yAnchors, yTargets, toleranceWorld, {
    pairFilter: (anchor, target) =>
      isOppositeEdgePair("y", anchor.name, target.edge) ||
      isSameEdgePair("y", anchor.name, target.edge)
  });

  const xCandidate = chooseBestAxisSnapCandidate(
    filterValidAxisCandidates(
      xDragCandidates,
      (candidate) => {
        const targetRectangle = rectanglesById.get(candidate.target.rectangleId);
        if (!targetRectangle) return false;
        const nextRectangle = {
          ...proposedRectangle,
          x: proposedRectangle.x + candidate.delta
        };
        return isValidDraggedAxisCandidateOnRectangle(nextRectangle, candidate, targetRectangle, "x");
      }
    )
  );
  const yCandidate = chooseBestAxisSnapCandidate(
    filterValidAxisCandidates(
      yDragCandidates,
      (candidate) => {
        const targetRectangle = rectanglesById.get(candidate.target.rectangleId);
        if (!targetRectangle) return false;
        const nextRectangle = {
          ...proposedRectangle,
          y: proposedRectangle.y + candidate.delta
        };
        return isValidDraggedAxisCandidateOnRectangle(nextRectangle, candidate, targetRectangle, "y");
      }
    )
  );

  const dualCandidate = chooseBestDragCornerSnap(proposedRectangle, xAnchors, yAnchors, xTargets, yTargets, toleranceWorld, rectanglesById);
  if (dualCandidate) {
    return dualCandidate;
  }

  const compatibleRawDualAxisCandidate = chooseBestCompatibleDragDualAxisSnap(
    proposedRectangle,
    xDragCandidates,
    yDragCandidates,
    rectanglesById
  );
  if (compatibleRawDualAxisCandidate) {
    return compatibleRawDualAxisCandidate;
  }

  const compatibleDualAxisCandidate = chooseCompatibleDragDualAxisSnap(
    proposedRectangle,
    xCandidate,
    yCandidate,
    rectanglesById
  );
  if (compatibleDualAxisCandidate) {
    return compatibleDualAxisCandidate;
  }

  if (!xCandidate && !yCandidate) {
    return {
      rectangle: proposedRectangle,
      snap: { x: null, y: null }
    };
  }

  const preferredAxis = choosePreferredDragSingleAxisSnapAxis(xCandidate, yCandidate);
  if (preferredAxis === "x" && xCandidate) {
    return {
      rectangle: {
        ...proposedRectangle,
        x: proposedRectangle.x + xCandidate.delta
      },
      snap: {
        x: xCandidate,
        y: null
      }
    };
  }

  if (preferredAxis === "y" && yCandidate) {
    return {
      rectangle: {
        ...proposedRectangle,
        y: proposedRectangle.y + yCandidate.delta
      },
      snap: {
        x: null,
        y: yCandidate
      }
    };
  }

  return {
    rectangle: proposedRectangle,
    snap: {
      x: null,
      y: null
    }
  };
}

export function snapResizedRectangle(proposedRectangle, handleName, rectangles, options = {}) {
  const toleranceWorld = options.toleranceWorld ?? 0;
  if (!isRectangleShape(proposedRectangle) || typeof handleName !== "string" || toleranceWorld <= 0) {
    return {
      rectangle: proposedRectangle,
      snap: { x: null, y: null }
    };
  }

  const { xTargets, yTargets } = buildRectangleSnapTargets(rectangles, {
    excludeRectangleId: options.excludeRectangleId ?? null
  });
  const rectanglesById = indexRectanglesById(rectangles);
  const minSize = options.minSize ?? 1;

  const xAnchors = [];
  if (handleName.includes("w")) {
    xAnchors.push({ name: "left", value: proposedRectangle.x });
  } else if (handleName.includes("e")) {
    xAnchors.push({ name: "right", value: proposedRectangle.x + proposedRectangle.w });
  }

  const yAnchors = [];
  if (handleName.includes("n")) {
    yAnchors.push({ name: "top", value: proposedRectangle.y });
  } else if (handleName.includes("s")) {
    yAnchors.push({ name: "bottom", value: proposedRectangle.y + proposedRectangle.h });
  }

  const xCandidate = chooseBestAxisSnapCandidate(
    filterValidAxisCandidates(
      generateAxisSnapCandidates(xAnchors, xTargets, toleranceWorld, {
        pairFilter: (anchor, target) =>
          isOppositeEdgePair("x", anchor.name, target.edge) ||
          isSameEdgePair("x", anchor.name, target.edge)
      }),
      (candidate) => {
        const targetRectangle = rectanglesById.get(candidate.target.rectangleId);
        if (!targetRectangle) return false;
        const nextRectangle = applyResizeAxisSnap({ ...proposedRectangle }, candidate.delta, handleName, "x", minSize);
        if (isOppositeEdgePair("x", candidate.anchor.name, candidate.target.edge)) {
          return (
            rectanglesTouchOnAxis(nextRectangle, targetRectangle, "x") &&
            rectanglesContactOrOverlapOnAxis(nextRectangle, targetRectangle, "y")
          );
        }
        return rectanglesTouchOnAxis(nextRectangle, targetRectangle, "y");
      }
    )
  );

  const yCandidate = chooseBestAxisSnapCandidate(
    filterValidAxisCandidates(
      generateAxisSnapCandidates(yAnchors, yTargets, toleranceWorld, {
        pairFilter: (anchor, target) =>
          isOppositeEdgePair("y", anchor.name, target.edge) ||
          isSameEdgePair("y", anchor.name, target.edge)
      }),
      (candidate) => {
        const targetRectangle = rectanglesById.get(candidate.target.rectangleId);
        if (!targetRectangle) return false;
        const nextRectangle = applyResizeAxisSnap({ ...proposedRectangle }, candidate.delta, handleName, "y", minSize);
        if (isOppositeEdgePair("y", candidate.anchor.name, candidate.target.edge)) {
          return (
            rectanglesTouchOnAxis(nextRectangle, targetRectangle, "y") &&
            rectanglesContactOrOverlapOnAxis(nextRectangle, targetRectangle, "x")
          );
        }
        return rectanglesTouchOnAxis(nextRectangle, targetRectangle, "x");
      }
    )
  );

  const dualCandidate = chooseBestResizeCornerSnap(
    proposedRectangle,
    handleName,
    xAnchors,
    yAnchors,
    xTargets,
    yTargets,
    toleranceWorld,
    rectanglesById,
    minSize
  );
  if (dualCandidate) {
    return dualCandidate;
  }

  if (!xCandidate && !yCandidate) {
    return {
      rectangle: proposedRectangle,
      snap: { x: null, y: null }
    };
  }

  if (xCandidate && (!yCandidate || xCandidate.distance <= yCandidate.distance)) {
    return {
      rectangle: applyResizeAxisSnap({ ...proposedRectangle }, xCandidate.delta, handleName, "x", minSize),
      snap: {
        x: xCandidate,
        y: null
      }
    };
  }

  return {
    rectangle: applyResizeAxisSnap({ ...proposedRectangle }, yCandidate.delta, handleName, "y", minSize),
    snap: {
      x: null,
      y: yCandidate
    }
  };
}

function applyResizeAxisSnap(rectangle, delta, handleName, axis, minSize) {
  if (!Number.isFinite(delta) || delta === 0) {
    return rectangle;
  }

  if (axis === "x") {
    if (handleName.includes("w")) {
      const nextX = rectangle.x + delta;
      const nextW = rectangle.w - delta;
      if (nextW < minSize) {
        return rectangle;
      }
      return {
        ...rectangle,
        x: nextX,
        w: nextW
      };
    }

    if (handleName.includes("e")) {
      const nextW = rectangle.w + delta;
      if (nextW < minSize) {
        return rectangle;
      }
      return {
        ...rectangle,
        w: nextW
      };
    }
  }

  if (axis === "y") {
    if (handleName.includes("n")) {
      const nextY = rectangle.y + delta;
      const nextH = rectangle.h - delta;
      if (nextH < minSize) {
        return rectangle;
      }
      return {
        ...rectangle,
        y: nextY,
        h: nextH
      };
    }

    if (handleName.includes("s")) {
      const nextH = rectangle.h + delta;
      if (nextH < minSize) {
        return rectangle;
      }
      return {
        ...rectangle,
        h: nextH
      };
    }
  }

  return rectangle;
}

function isRectangleShape(value) {
  return (
    value != null &&
    Number.isFinite(value.x) &&
    Number.isFinite(value.y) &&
    Number.isFinite(value.w) &&
    Number.isFinite(value.h)
  );
}

function chooseBestDragCornerSnap(proposedRectangle, xAnchors, yAnchors, xTargets, yTargets, toleranceWorld, rectanglesById) {
  const xCandidates = generateAxisSnapCandidates(xAnchors, xTargets, toleranceWorld, {
    pairFilter: (anchor, target) => isOppositeEdgePair("x", anchor.name, target.edge)
  });
  const yCandidates = generateAxisSnapCandidates(yAnchors, yTargets, toleranceWorld, {
    pairFilter: (anchor, target) => isOppositeEdgePair("y", anchor.name, target.edge)
  });

  let best = null;

  for (const xCandidate of xCandidates) {
    for (const yCandidate of yCandidates) {
      if (xCandidate.target.rectangleId !== yCandidate.target.rectangleId) {
        continue;
      }

      const targetRectangle = rectanglesById.get(xCandidate.target.rectangleId);
      if (!targetRectangle) {
        continue;
      }

      const nextRectangle = {
        ...proposedRectangle,
        x: proposedRectangle.x + xCandidate.delta,
        y: proposedRectangle.y + yCandidate.delta
      };

      if (!rectanglesTouchOnAxis(nextRectangle, targetRectangle, "x")) {
        continue;
      }
      if (!rectanglesTouchOnAxis(nextRectangle, targetRectangle, "y")) {
        continue;
      }

      const score = xCandidate.distance + yCandidate.distance;
      if (!best || score < best.score) {
        best = { xCandidate, yCandidate, nextRectangle, score };
      }
    }
  }

  if (!best) {
    return null;
  }

  return {
    rectangle: best.nextRectangle,
    snap: {
      x: best.xCandidate,
      y: best.yCandidate
    }
  };
}

function chooseCompatibleDragDualAxisSnap(proposedRectangle, xCandidate, yCandidate, rectanglesById) {
  if (!xCandidate || !yCandidate) {
    return null;
  }

  const xTargetRectangle = rectanglesById.get(xCandidate.target.rectangleId);
  const yTargetRectangle = rectanglesById.get(yCandidate.target.rectangleId);
  if (!xTargetRectangle || !yTargetRectangle) {
    return null;
  }

  const nextRectangle = {
    ...proposedRectangle,
    x: proposedRectangle.x + xCandidate.delta,
    y: proposedRectangle.y + yCandidate.delta
  };

  if (!isValidDraggedAxisCandidateOnRectangle(nextRectangle, xCandidate, xTargetRectangle, "x")) {
    return null;
  }
  if (!isValidDraggedAxisCandidateOnRectangle(nextRectangle, yCandidate, yTargetRectangle, "y")) {
    return null;
  }

  return {
    rectangle: nextRectangle,
    snap: {
      x: xCandidate,
      y: yCandidate
    }
  };
}

function chooseBestCompatibleDragDualAxisSnap(proposedRectangle, xCandidates, yCandidates, rectanglesById) {
  if (!Array.isArray(xCandidates) || !Array.isArray(yCandidates) || xCandidates.length === 0 || yCandidates.length === 0) {
    return null;
  }

  let best = null;

  for (const xCandidate of xCandidates) {
    const xTargetRectangle = rectanglesById.get(xCandidate?.target?.rectangleId);
    if (!xTargetRectangle) {
      continue;
    }

    for (const yCandidate of yCandidates) {
      const yTargetRectangle = rectanglesById.get(yCandidate?.target?.rectangleId);
      if (!yTargetRectangle) {
        continue;
      }

      const nextRectangle = {
        ...proposedRectangle,
        x: proposedRectangle.x + xCandidate.delta,
        y: proposedRectangle.y + yCandidate.delta
      };

      if (!isValidDraggedAxisCandidateOnRectangle(nextRectangle, xCandidate, xTargetRectangle, "x")) {
        continue;
      }
      if (!isValidDraggedAxisCandidateOnRectangle(nextRectangle, yCandidate, yTargetRectangle, "y")) {
        continue;
      }

      const score = xCandidate.distance + yCandidate.distance;
      if (
        !best ||
        score < best.score ||
        (score === best.score && Math.abs(xCandidate.delta) + Math.abs(yCandidate.delta) < best.magnitude)
      ) {
        best = {
          score,
          magnitude: Math.abs(xCandidate.delta) + Math.abs(yCandidate.delta),
          xCandidate,
          yCandidate,
          nextRectangle
        };
      }
    }
  }

  if (!best) {
    return null;
  }

  return {
    rectangle: best.nextRectangle,
    snap: {
      x: best.xCandidate,
      y: best.yCandidate
    }
  };
}

function chooseBestResizeCornerSnap(
  proposedRectangle,
  handleName,
  xAnchors,
  yAnchors,
  xTargets,
  yTargets,
  toleranceWorld,
  rectanglesById,
  minSize
) {
  const xCandidates = generateAxisSnapCandidates(xAnchors, xTargets, toleranceWorld, {
    pairFilter: (anchor, target) => isOppositeEdgePair("x", anchor.name, target.edge)
  });
  const yCandidates = generateAxisSnapCandidates(yAnchors, yTargets, toleranceWorld, {
    pairFilter: (anchor, target) => isOppositeEdgePair("y", anchor.name, target.edge)
  });

  let best = null;

  for (const xCandidate of xCandidates) {
    for (const yCandidate of yCandidates) {
      if (xCandidate.target.rectangleId !== yCandidate.target.rectangleId) {
        continue;
      }

      const targetRectangle = rectanglesById.get(xCandidate.target.rectangleId);
      if (!targetRectangle) {
        continue;
      }

      let nextRectangle = applyResizeAxisSnap({ ...proposedRectangle }, xCandidate.delta, handleName, "x", minSize);
      nextRectangle = applyResizeAxisSnap(nextRectangle, yCandidate.delta, handleName, "y", minSize);

      if (!rectanglesTouchOnAxis(nextRectangle, targetRectangle, "x")) {
        continue;
      }
      if (!rectanglesTouchOnAxis(nextRectangle, targetRectangle, "y")) {
        continue;
      }

      const score = xCandidate.distance + yCandidate.distance;
      if (!best || score < best.score) {
        best = { xCandidate, yCandidate, nextRectangle, score };
      }
    }
  }

  if (!best) {
    return null;
  }

  return {
    rectangle: best.nextRectangle,
    snap: {
      x: best.xCandidate,
      y: best.yCandidate
    }
  };
}

function filterValidAxisCandidates(candidates, predicate) {
  if (!Array.isArray(candidates) || typeof predicate !== "function") {
    return [];
  }

  const result = [];
  for (const candidate of candidates) {
    if (predicate(candidate)) {
      result.push(candidate);
    }
  }
  return result;
}

function isValidDraggedAxisCandidateOnRectangle(nextRectangle, candidate, targetRectangle, axis) {
  if (!candidate || !targetRectangle) {
    return false;
  }

  if (isOppositeEdgePair(axis, candidate.anchor.name, candidate.target.edge)) {
    return (
      rectanglesTouchOnAxis(nextRectangle, targetRectangle, axis) &&
      rectanglesContactOrOverlapOnAxis(nextRectangle, targetRectangle, perpendicularAxis(axis))
    );
  }

  if (isSameEdgePair(axis, candidate.anchor.name, candidate.target.edge)) {
    return rectanglesTouchOnAxis(nextRectangle, targetRectangle, perpendicularAxis(axis));
  }

  return false;
}

function choosePreferredDragSingleAxisSnapAxis(xCandidate, yCandidate) {
  if (!xCandidate && !yCandidate) {
    return null;
  }
  if (!xCandidate) {
    return "y";
  }
  if (!yCandidate) {
    return "x";
  }

  const epsilon = 1e-6;
  const xIsMaintainedConstraint = approximatelyEqual(xCandidate.delta, 0, epsilon);
  const yIsMaintainedConstraint = approximatelyEqual(yCandidate.delta, 0, epsilon);

  if (xIsMaintainedConstraint && !yIsMaintainedConstraint) {
    return "y";
  }
  if (yIsMaintainedConstraint && !xIsMaintainedConstraint) {
    return "x";
  }

  if (xCandidate.distance < yCandidate.distance) {
    return "x";
  }
  if (yCandidate.distance < xCandidate.distance) {
    return "y";
  }

  if (Math.abs(xCandidate.delta) < Math.abs(yCandidate.delta)) {
    return "x";
  }
  if (Math.abs(yCandidate.delta) < Math.abs(xCandidate.delta)) {
    return "y";
  }

  return "x";
}

function indexRectanglesById(rectangles) {
  const map = new Map();
  for (const rectangle of rectangles ?? []) {
    if (!rectangle || typeof rectangle.id !== "string") {
      continue;
    }
    map.set(rectangle.id, rectangle);
  }
  return map;
}

function perpendicularAxis(axis) {
  return axis === "x" ? "y" : axis === "y" ? "x" : null;
}

function isOppositeEdgePair(axis, anchorEdge, targetEdge) {
  if (axis === "x") {
    return (
      (anchorEdge === "left" && targetEdge === "right") ||
      (anchorEdge === "right" && targetEdge === "left")
    );
  }

  if (axis === "y") {
    return (
      (anchorEdge === "top" && targetEdge === "bottom") ||
      (anchorEdge === "bottom" && targetEdge === "top")
    );
  }

  return false;
}

function isSameEdgePair(axis, anchorEdge, targetEdge) {
  if (axis === "x") {
    return (
      (anchorEdge === "left" && targetEdge === "left") ||
      (anchorEdge === "right" && targetEdge === "right")
    );
  }

  if (axis === "y") {
    return (
      (anchorEdge === "top" && targetEdge === "top") ||
      (anchorEdge === "bottom" && targetEdge === "bottom")
    );
  }

  return false;
}

function rectanglesTouchOnAxis(rectangleA, rectangleB, axis) {
  const epsilon = 1e-6;
  if (axis === "x") {
    return (
      approximatelyEqual(rectangleA.x + rectangleA.w, rectangleB.x, epsilon) ||
      approximatelyEqual(rectangleA.x, rectangleB.x + rectangleB.w, epsilon)
    );
  }

  if (axis === "y") {
    return (
      approximatelyEqual(rectangleA.y + rectangleA.h, rectangleB.y, epsilon) ||
      approximatelyEqual(rectangleA.y, rectangleB.y + rectangleB.h, epsilon)
    );
  }

  return false;
}

function rectanglesOverlapOnAxis(rectangleA, rectangleB, axis) {
  const epsilon = 1e-6;
  if (axis === "x") {
    return intervalOverlapLength(rectangleA.x, rectangleA.x + rectangleA.w, rectangleB.x, rectangleB.x + rectangleB.w) > epsilon;
  }
  if (axis === "y") {
    return intervalOverlapLength(rectangleA.y, rectangleA.y + rectangleA.h, rectangleB.y, rectangleB.y + rectangleB.h) > epsilon;
  }
  return false;
}

function rectanglesContactOrOverlapOnAxis(rectangleA, rectangleB, axis) {
  return rectanglesTouchOnAxis(rectangleA, rectangleB, axis) || rectanglesOverlapOnAxis(rectangleA, rectangleB, axis);
}

function intervalOverlapLength(a0, a1, b0, b1) {
  return Math.max(0, Math.min(a1, b1) - Math.max(a0, b0));
}

function approximatelyEqual(a, b, epsilon) {
  return Math.abs(a - b) <= epsilon;
}
