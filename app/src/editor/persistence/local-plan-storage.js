import { createEmptyPlan } from "../state/plan.js";

const DEFAULT_STORAGE_KEY = "apartment-planner.mvp.last-plan.v1";
const DEFAULT_AUTOSAVE_DEBOUNCE_MS = 300;

export function loadPersistedPlan(options = {}) {
  const storage = options.storage ?? getLocalStorage();
  const key = options.key ?? DEFAULT_STORAGE_KEY;

  if (!storage) {
    return { plan: null, source: "storage-unavailable", key };
  }

  let rawJson = null;
  try {
    rawJson = storage.getItem(key);
  } catch (error) {
    console.warn("Failed to read persisted plan from localStorage.", error);
    return { plan: null, source: "storage-read-error", key, error };
  }

  if (!rawJson) {
    return { plan: null, source: "none", key };
  }

  let raw = null;
  try {
    raw = JSON.parse(rawJson);
  } catch (error) {
    console.warn("Persisted plan JSON is invalid. Falling back to default plan.", error);
    return { plan: null, source: "parse-error", key, error };
  }

  try {
    return {
      plan: migratePlan(raw),
      source: "localStorage",
      key
    };
  } catch (error) {
    console.warn("Persisted plan shape is invalid. Falling back to default plan.", error);
    return { plan: null, source: "invalid-plan", key, error };
  }
}

export function createPlanAutosaveController(store, options = {}) {
  const storage = options.storage ?? getLocalStorage();
  const key = options.key ?? DEFAULT_STORAGE_KEY;
  const debounceMs = options.debounceMs ?? DEFAULT_AUTOSAVE_DEBOUNCE_MS;
  const onStatus = typeof options.onStatus === "function" ? options.onStatus : null;

  let timeoutId = null;
  let pendingPlan = null;
  let destroyed = false;
  let status = {
    phase: storage ? "idle" : "disabled",
    key,
    lastSavedAt: null,
    lastActionType: null,
    errorMessage: null
  };

  emitStatus();

  const unsubscribe = store.subscribe((state, action) => {
    if (!action?.type || !action.type.startsWith("plan/")) {
      return;
    }
    if (!storage) {
      return;
    }

    pendingPlan = state.plan;
    status = {
      ...status,
      phase: "scheduled",
      lastActionType: action.type,
      errorMessage: null
    };
    emitStatus();

    if (timeoutId != null) {
      clearTimeout(timeoutId);
    }

    timeoutId = setTimeout(() => {
      flushNow("debounce");
    }, debounceMs);
  });

  const onPageHide = () => {
    flushNow("pagehide");
  };

  if (typeof window !== "undefined") {
    window.addEventListener("pagehide", onPageHide);
  }

  return {
    destroy,
    flushNow,
    getStatusSnapshot
  };

  function destroy() {
    if (destroyed) return;
    destroyed = true;

    flushNow("destroy");

    if (timeoutId != null) {
      clearTimeout(timeoutId);
      timeoutId = null;
    }

    unsubscribe();

    if (typeof window !== "undefined") {
      window.removeEventListener("pagehide", onPageHide);
    }
  }

  function flushNow(reason = "manual") {
    if (!storage || !pendingPlan) {
      return false;
    }

    if (timeoutId != null) {
      clearTimeout(timeoutId);
      timeoutId = null;
    }

    try {
      storage.setItem(key, JSON.stringify(pendingPlan));
      status = {
        ...status,
        phase: "saved",
        lastSavedAt: new Date().toISOString(),
        errorMessage: null
      };
      pendingPlan = null;
      emitStatus({ reason });
      return true;
    } catch (error) {
      status = {
        ...status,
        phase: "error",
        errorMessage: error instanceof Error ? error.message : String(error)
      };
      emitStatus({ reason });
      console.warn("Failed to autosave plan to localStorage.", error);
      return false;
    }
  }

  function getStatusSnapshot() {
    return { ...status };
  }

  function emitStatus(extra = {}) {
    if (onStatus) {
      onStatus({ ...status, ...extra });
    }
  }
}

function migratePlan(raw) {
  if (!isPlainObject(raw)) {
    throw new Error("Plan must be an object.");
  }

  if (raw.version !== 1) {
    throw new Error(`Unsupported plan version: ${String(raw.version)}`);
  }

  const base = createEmptyPlan();
  const entities = isPlainObject(raw.entities) ? raw.entities : {};
  const background = isPlainObject(raw.background) ? raw.background : {};
  const backgroundTransform = isPlainObject(background.transform) ? background.transform : {};
  const scale = isPlainObject(raw.scale) ? raw.scale : {};
  const meta = isPlainObject(raw.meta) ? raw.meta : {};

  return {
    ...base,
    version: 1,
    planId: typeof raw.planId === "string" && raw.planId ? raw.planId : base.planId,
    meta: {
      ...base.meta,
      name: typeof meta.name === "string" && meta.name ? meta.name : base.meta.name,
      createdAt: typeof meta.createdAt === "string" ? meta.createdAt : base.meta.createdAt,
      updatedAt: typeof meta.updatedAt === "string" ? meta.updatedAt : base.meta.updatedAt
    },
    background: {
      ...base.background,
      sourceType: typeof background.sourceType === "string" ? background.sourceType : base.background.sourceType,
      source: typeof background.source === "string" ? background.source : base.background.source,
      opacity: clampNumber(background.opacity, 0, 1, base.background.opacity),
      transform: {
        ...base.background.transform,
        x: finiteNumber(backgroundTransform.x, base.background.transform.x),
        y: finiteNumber(backgroundTransform.y, base.background.transform.y),
        width: positiveNumber(backgroundTransform.width, base.background.transform.width),
        height: positiveNumber(backgroundTransform.height, base.background.transform.height)
      }
    },
    scale: {
      metersPerWorldUnit: positiveNumberOrNull(scale.metersPerWorldUnit, base.scale.metersPerWorldUnit),
      referenceLine: normalizeReferenceLine(scale.referenceLine)
    },
    entities: {
      rectangles: normalizeRectangles(entities.rectangles),
      openings: Array.isArray(entities.openings) ? entities.openings.slice() : [],
      rooms: Array.isArray(entities.rooms) ? entities.rooms.slice() : []
    }
  };
}

function normalizeRectangles(rawRectangles) {
  if (!Array.isArray(rawRectangles)) {
    return [];
  }

  const result = [];
  for (let index = 0; index < rawRectangles.length; index += 1) {
    const rawRectangle = rawRectangles[index];
    if (!isPlainObject(rawRectangle)) {
      continue;
    }

    const x = finiteNumber(rawRectangle.x, null);
    const y = finiteNumber(rawRectangle.y, null);
    const w = positiveNumber(rawRectangle.w, null);
    const h = positiveNumber(rawRectangle.h, null);
    if (x == null || y == null || w == null || h == null) {
      continue;
    }

    result.push({
      ...rawRectangle,
      id: typeof rawRectangle.id === "string" ? rawRectangle.id : `rect_migrated_${index + 1}`,
      kind: typeof rawRectangle.kind === "string" ? rawRectangle.kind : "roomRect",
      x,
      y,
      w,
      h,
      wallCm: normalizeWallCm(rawRectangle.wallCm),
      roomId: typeof rawRectangle.roomId === "string" ? rawRectangle.roomId : null,
      label: typeof rawRectangle.label === "string" ? rawRectangle.label : null
    });
  }

  return result;
}

function normalizeWallCm(rawWallCm) {
  const wallCm = isPlainObject(rawWallCm) ? rawWallCm : {};
  return {
    top: nonNegativeNumber(wallCm.top, 0),
    right: nonNegativeNumber(wallCm.right, 0),
    bottom: nonNegativeNumber(wallCm.bottom, 0),
    left: nonNegativeNumber(wallCm.left, 0)
  };
}

function normalizeReferenceLine(rawReferenceLine) {
  if (!isPlainObject(rawReferenceLine)) {
    return null;
  }

  const x0 = finiteNumber(rawReferenceLine.x0, null);
  const y0 = finiteNumber(rawReferenceLine.y0, null);
  const x1 = finiteNumber(rawReferenceLine.x1, null);
  const y1 = finiteNumber(rawReferenceLine.y1, null);
  const meters = positiveNumber(rawReferenceLine.meters, null);

  if (x0 == null || y0 == null || x1 == null || y1 == null || meters == null) {
    return null;
  }

  return { x0, y0, x1, y1, meters };
}

function getLocalStorage() {
  try {
    if (typeof window === "undefined" || !window.localStorage) {
      return null;
    }
    return window.localStorage;
  } catch {
    return null;
  }
}

function isPlainObject(value) {
  return value != null && typeof value === "object" && !Array.isArray(value);
}

function finiteNumber(value, fallback) {
  return Number.isFinite(value) ? value : fallback;
}

function positiveNumber(value, fallback) {
  return Number.isFinite(value) && value > 0 ? value : fallback;
}

function positiveNumberOrNull(value, fallback) {
  if (value == null) {
    return null;
  }
  return positiveNumber(value, fallback);
}

function nonNegativeNumber(value, fallback) {
  return Number.isFinite(value) && value >= 0 ? value : fallback;
}

function clampNumber(value, min, max, fallback) {
  if (!Number.isFinite(value)) {
    return fallback;
  }
  return Math.min(max, Math.max(min, value));
}
