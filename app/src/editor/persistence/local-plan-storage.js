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

export function parseImportedPlanJsonText(jsonText) {
  if (typeof jsonText !== "string") {
    throw new Error("Imported file must contain JSON text.");
  }

  let raw = null;
  try {
    raw = JSON.parse(jsonText);
  } catch (error) {
    throw new Error(
      `Invalid JSON: ${error instanceof Error && error.message ? error.message : String(error)}`
    );
  }

  return migratePlan(raw);
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
      rooms: normalizeRooms(entities.rooms),
      lighting: normalizeLighting(entities.lighting)
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

function normalizeRooms(rawRooms) {
  if (!Array.isArray(rawRooms)) {
    return [];
  }

  const result = [];
  for (let index = 0; index < rawRooms.length; index += 1) {
    const rawRoom = rawRooms[index];
    if (!isPlainObject(rawRoom)) {
      continue;
    }

    const id = typeof rawRoom.id === "string" && rawRoom.id ? rawRoom.id : `room_migrated_${index + 1}`;
    const name = typeof rawRoom.name === "string" && rawRoom.name.trim() ? rawRoom.name.trim() : `Room ${index + 1}`;
    const roomType = typeof rawRoom.roomType === "string" && rawRoom.roomType.trim()
      ? rawRoom.roomType.trim()
      : "generic";
    const rectangleIds = Array.isArray(rawRoom.rectangleIds)
      ? Array.from(
        new Set(
          rawRoom.rectangleIds.filter((rectangleId) => typeof rectangleId === "string" && rectangleId)
        )
      )
      : [];

    if (rectangleIds.length === 0) {
      continue;
    }

    result.push({
      id,
      name,
      roomType,
      rectangleIds
    });
  }

  return result;
}

function normalizeLighting(rawLighting) {
  const lighting = isPlainObject(rawLighting) ? rawLighting : {};
  const fixtures = normalizeLightingFixtures(lighting.fixtures);
  const groups = normalizeLightingGroups(lighting.groups, fixtures);
  const links = normalizeLightingLinks(lighting.links, fixtures, groups);
  return { fixtures, groups, links };
}

function normalizeLightingFixtures(rawFixtures) {
  if (!Array.isArray(rawFixtures)) {
    return [];
  }

  const fixtures = [];
  for (let index = 0; index < rawFixtures.length; index += 1) {
    const rawFixture = rawFixtures[index];
    if (!isPlainObject(rawFixture)) {
      continue;
    }
    const id = normalizeNonEmptyString(rawFixture.id) ?? `fx_migrated_${index + 1}`;
    const kind = rawFixture.kind === "switch" || rawFixture.kind === "lamp"
      ? rawFixture.kind
      : null;
    const x = finiteNumber(rawFixture.x, null);
    const y = finiteNumber(rawFixture.y, null);
    if (!kind || x == null || y == null) {
      continue;
    }
    const subtype = normalizeNonEmptyString(rawFixture.subtype) ?? (kind === "switch" ? "switch_single" : "led_spot");
    const roomId = normalizeNonEmptyString(rawFixture.roomId);
    const host = normalizeLightingFixtureHost(rawFixture.host, kind);
    if (!host) {
      continue;
    }
    const label = normalizeNonEmptyString(rawFixture?.meta?.label);
    fixtures.push({
      id,
      kind,
      subtype,
      x,
      y,
      roomId: roomId ?? null,
      host,
      meta: {
        label: label ?? null
      }
    });
  }
  return fixtures;
}

function normalizeLightingFixtureHost(rawHost, kind) {
  if (kind === "switch") {
    if (!isPlainObject(rawHost) || rawHost.type !== "wallSide") {
      return null;
    }
    const rectangleId = normalizeNonEmptyString(rawHost.rectangleId);
    const side = rawHost.side;
    if (
      !rectangleId ||
      (side !== "top" && side !== "right" && side !== "bottom" && side !== "left")
    ) {
      return null;
    }
    const offset = clampNumber(rawHost.offset, 0, 1, null);
    if (offset == null) {
      return null;
    }
    return {
      type: "wallSide",
      rectangleId,
      side,
      offset
    };
  }
  if (!isPlainObject(rawHost) || rawHost.type !== "roomInterior") {
    return {
      type: "roomInterior",
      rectangleId: null,
      offsetX: null,
      offsetY: null
    };
  }
  const rectangleId = normalizeNonEmptyString(rawHost.rectangleId);
  const offsetX = finiteNumber(rawHost.offsetX, null);
  const offsetY = finiteNumber(rawHost.offsetY, null);
  return {
    type: "roomInterior",
    rectangleId: rectangleId ?? null,
    offsetX,
    offsetY
  };
}

function normalizeLightingGroups(rawGroups, fixtures) {
  if (!Array.isArray(rawGroups)) {
    return [];
  }

  const lampFixtureIds = new Set(
    fixtures
      .filter((fixture) => fixture?.kind === "lamp")
      .map((fixture) => fixture.id)
  );
  const groups = [];
  for (let index = 0; index < rawGroups.length; index += 1) {
    const rawGroup = rawGroups[index];
    if (!isPlainObject(rawGroup)) {
      continue;
    }
    const id = normalizeNonEmptyString(rawGroup.id) ?? `lg_migrated_${index + 1}`;
    const name = normalizeNonEmptyString(rawGroup.name) ?? `Lamp Group ${index + 1}`;
    const roomId = normalizeNonEmptyString(rawGroup.roomId);
    const fixtureIds = Array.isArray(rawGroup.fixtureIds)
      ? Array.from(
        new Set(
          rawGroup.fixtureIds
            .map((fixtureId) => normalizeNonEmptyString(fixtureId))
            .filter((fixtureId) => fixtureId && lampFixtureIds.has(fixtureId))
        )
      )
      : [];
    if (fixtureIds.length === 0) {
      continue;
    }
    groups.push({
      id,
      kind: "lampGroup",
      name,
      roomId: roomId ?? null,
      fixtureIds,
      meta: isPlainObject(rawGroup.meta) ? rawGroup.meta : {}
    });
  }
  return groups;
}

function normalizeLightingLinks(rawLinks, fixtures, groups) {
  if (!Array.isArray(rawLinks)) {
    return [];
  }
  const switchIds = new Set(
    fixtures
      .filter((fixture) => fixture?.kind === "switch")
      .map((fixture) => fixture.id)
  );
  const lampIds = new Set(
    fixtures
      .filter((fixture) => fixture?.kind === "lamp")
      .map((fixture) => fixture.id)
  );
  const groupIds = new Set(
    groups
      .filter((group) => typeof group?.id === "string" && group.id)
      .map((group) => group.id)
  );
  const dedupeKey = new Set();
  const links = [];

  for (let index = 0; index < rawLinks.length; index += 1) {
    const rawLink = rawLinks[index];
    if (!isPlainObject(rawLink)) {
      continue;
    }
    const switchId = normalizeNonEmptyString(rawLink.switchId);
    const targetType = rawLink.targetType === "lamp" || rawLink.targetType === "lampGroup"
      ? rawLink.targetType
      : null;
    const targetId = normalizeNonEmptyString(rawLink.targetId);
    if (!switchId || !targetType || !targetId || !switchIds.has(switchId)) {
      continue;
    }
    if (targetType === "lamp" && !lampIds.has(targetId)) {
      continue;
    }
    if (targetType === "lampGroup" && !groupIds.has(targetId)) {
      continue;
    }
    const edgeKey = `${switchId}|${targetType}|${targetId}`;
    if (dedupeKey.has(edgeKey)) {
      continue;
    }
    dedupeKey.add(edgeKey);
    links.push({
      id: normalizeNonEmptyString(rawLink.id) ?? `lk_migrated_${index + 1}`,
      switchId,
      targetType,
      targetId
    });
  }

  return links;
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

function normalizeNonEmptyString(value) {
  if (typeof value !== "string") {
    return null;
  }
  const normalized = value.trim();
  return normalized ? normalized : null;
}
