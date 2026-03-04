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
  const settings = isPlainObject(raw.settings) ? raw.settings : {};
  const view = isPlainObject(raw.view) ? raw.view : {};
  const quote = isPlainObject(raw.quote) ? raw.quote : {};
  const meta = isPlainObject(raw.meta) ? raw.meta : {};
  const normalizedRectangles = normalizeRectangles(entities.rectangles);

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
    settings: normalizePlanSettings(settings, base.settings),
    view: normalizePlanView(view, base.view),
    quote: normalizeQuote(quote, base.quote),
    entities: {
      rectangles: normalizedRectangles,
      openings: normalizeOpenings(entities.openings, normalizedRectangles),
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

function normalizePlanSettings(rawSettings, baseSettings) {
  const settings = isPlainObject(rawSettings) ? rawSettings : {};
  const base = isPlainObject(baseSettings) ? baseSettings : { wallHeightMeters: 2.7 };
  return {
    ...base,
    wallHeightMeters: positiveNumber(settings.wallHeightMeters, base.wallHeightMeters)
  };
}

function normalizePlanView(rawView, baseView) {
  const view = isPlainObject(rawView) ? rawView : {};
  const base = isPlainObject(baseView) ? baseView : { roomHighlighting: true, wallsBlack: false };
  return {
    roomHighlighting: view.roomHighlighting === undefined ? base.roomHighlighting : view.roomHighlighting !== false,
    wallsBlack: view.wallsBlack === undefined ? Boolean(base.wallsBlack) : Boolean(view.wallsBlack)
  };
}

function normalizeQuote(rawQuote, baseQuote) {
  const quote = isPlainObject(rawQuote) ? rawQuote : {};
  const base = isPlainObject(baseQuote) ? baseQuote : {};
  const baseCatalog = isPlainObject(base.catalog) ? base.catalog : {};
  const baseDefaults = isPlainObject(base.defaults) ? base.defaults : {};
  const baseRoomConfigs = isPlainObject(base.roomConfigs) ? base.roomConfigs : {};
  const catalog = isPlainObject(quote.catalog) ? quote.catalog : {};
  const defaults = isPlainObject(quote.defaults) ? quote.defaults : {};
  const roomConfigs = isPlainObject(quote.roomConfigs) ? quote.roomConfigs : {};

  return {
    groupMode: quote.groupMode === "job" ? "job" : (base.groupMode === "job" ? "job" : "room"),
    catalog: {
      baseboardProfiles: normalizeQuoteCatalogList(catalog.baseboardProfiles, baseCatalog.baseboardProfiles, "baseboard"),
      flooringTypes: normalizeQuoteCatalogList(catalog.flooringTypes, baseCatalog.flooringTypes, "area"),
      paintingTypes: normalizeQuoteCatalogList(catalog.paintingTypes, baseCatalog.paintingTypes, "area"),
      switchProducts: normalizeQuoteCatalogList(catalog.switchProducts, baseCatalog.switchProducts, "unit"),
      lampProducts: normalizeQuoteCatalogList(catalog.lampProducts, baseCatalog.lampProducts, "unit"),
      doorProducts: normalizeQuoteCatalogList(catalog.doorProducts, baseCatalog.doorProducts, "unit")
    },
    defaults: {
      baseboardProfileId: normalizeNonEmptyString(defaults.baseboardProfileId) ?? normalizeNonEmptyString(baseDefaults.baseboardProfileId),
      flooringTypeId: normalizeNonEmptyString(defaults.flooringTypeId) ?? normalizeNonEmptyString(baseDefaults.flooringTypeId),
      paintingTypeId: normalizeNonEmptyString(defaults.paintingTypeId) ?? normalizeNonEmptyString(baseDefaults.paintingTypeId),
      switchProductId: normalizeNonEmptyString(defaults.switchProductId) ?? normalizeNonEmptyString(baseDefaults.switchProductId),
      lampProductId: normalizeNonEmptyString(defaults.lampProductId) ?? normalizeNonEmptyString(baseDefaults.lampProductId),
      doorProductId: normalizeNonEmptyString(defaults.doorProductId) ?? normalizeNonEmptyString(baseDefaults.doorProductId)
    },
    roomConfigs: normalizeQuoteRoomConfigs(roomConfigs, baseRoomConfigs)
  };
}

function normalizeQuoteCatalogList(rawList, fallbackList, mode) {
  const source = Array.isArray(rawList) ? rawList : (Array.isArray(fallbackList) ? fallbackList : []);
  const normalized = [];
  for (const rawItem of source) {
    if (!isPlainObject(rawItem)) {
      continue;
    }
    const id = normalizeNonEmptyString(rawItem.id);
    const name = normalizeNonEmptyString(rawItem.name);
    if (!id || !name || normalized.some((item) => item.id === id)) {
      continue;
    }
    if (mode === "baseboard") {
      normalized.push({
        id,
        name,
        materialPerM: nonNegativeNumber(rawItem.materialPerM, 0),
        laborPerM: nonNegativeNumber(rawItem.laborPerM, 0)
      });
      continue;
    }
    if (mode === "area") {
      normalized.push({
        id,
        name,
        materialPerM2: nonNegativeNumber(rawItem.materialPerM2, 0),
        laborPerM2: nonNegativeNumber(rawItem.laborPerM2, 0)
      });
      continue;
    }
    normalized.push({
      id,
      name,
      unitPrice: nonNegativeNumber(rawItem.unitPrice, 0)
    });
  }
  return normalized;
}

function normalizeQuoteRoomConfigs(rawRoomConfigs, fallbackRoomConfigs) {
  const source = isPlainObject(rawRoomConfigs)
    ? rawRoomConfigs
    : (isPlainObject(fallbackRoomConfigs) ? fallbackRoomConfigs : {});
  const normalized = {};
  for (const [roomEntryId, rawConfig] of Object.entries(source)) {
    const id = normalizeNonEmptyString(roomEntryId);
    if (!id || !isPlainObject(rawConfig)) {
      continue;
    }
    normalized[id] = {
      includeBaseboard: rawConfig.includeBaseboard !== false,
      flooringTypeId: normalizeNonEmptyString(rawConfig.flooringTypeId),
      paintingTypeId: normalizeNonEmptyString(rawConfig.paintingTypeId),
      baseboardProfileId: normalizeNonEmptyString(rawConfig.baseboardProfileId)
    };
  }
  return normalized;
}

function normalizeOpenings(rawOpenings, rectangles = []) {
  if (!Array.isArray(rawOpenings)) {
    return [];
  }
  const rectangleById = new Map(
    Array.isArray(rectangles)
      ? rectangles
        .filter((rectangle) => typeof rectangle?.id === "string" && rectangle.id)
        .map((rectangle) => [rectangle.id, rectangle])
      : []
  );
  const result = [];
  for (let index = 0; index < rawOpenings.length; index += 1) {
    const rawOpening = rawOpenings[index];
    if (!isPlainObject(rawOpening)) {
      continue;
    }
    const id = typeof rawOpening.id === "string" && rawOpening.id ? rawOpening.id : `op_migrated_${index + 1}`;
    const kind = rawOpening.kind === "door" || rawOpening.kind === "window" ? rawOpening.kind : "door";
    const host = normalizeOpeningHost(rawOpening.host);
    const widthWorld = positiveNumber(rawOpening.widthWorld, null);
    if (!host || widthWorld == null) {
      continue;
    }
    const rectangle = rectangleById.get(host.rectangleId);
    if (!rectangle) {
      continue;
    }
    result.push({
      id,
      kind,
      host,
      widthWorld,
      x: finiteNumber(rawOpening.x, rectangle.x),
      y: finiteNumber(rawOpening.y, rectangle.y),
      productId: kind === "door" ? normalizeNonEmptyString(rawOpening.productId) : null
    });
  }
  return result;
}

function normalizeOpeningHost(rawHost) {
  const host = isPlainObject(rawHost) ? rawHost : null;
  if (!host || host.type !== "wallSide") {
    return null;
  }
  const rectangleId = typeof host.rectangleId === "string" && host.rectangleId ? host.rectangleId : null;
  const side = normalizeWallSide(host.side ?? host.edge);
  const offset = clampNumber(host.offset, 0, 1, null);
  if (!rectangleId || !side || offset == null) {
    return null;
  }
  return {
    type: "wallSide",
    rectangleId,
    side,
    offset
  };
}

function normalizeWallSide(side) {
  if (side === "top" || side === "right" || side === "bottom" || side === "left") {
    return side;
  }
  return null;
}

function normalizeLighting(rawLighting) {
  const lighting = isPlainObject(rawLighting) ? rawLighting : {};
  const fixtures = normalizeLightingFixtures(lighting.fixtures);
  const legacyGroupsById = buildLegacyLightingGroupIndex(lighting.groups, fixtures);
  const links = normalizeLightingLinks(lighting.links, fixtures, legacyGroupsById);
  return { fixtures, links };
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
      productId: normalizeNonEmptyString(rawFixture.productId),
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

function buildLegacyLightingGroupIndex(rawGroups, fixtures) {
  const indexById = new Map();
  if (!Array.isArray(rawGroups)) {
    return indexById;
  }
  const lampFixtureIds = new Set(
    fixtures
      .filter((fixture) => fixture?.kind === "lamp")
      .map((fixture) => fixture.id)
  );
  for (let index = 0; index < rawGroups.length; index += 1) {
    const rawGroup = rawGroups[index];
    if (!isPlainObject(rawGroup)) {
      continue;
    }
    const groupId = normalizeNonEmptyString(rawGroup.id) ?? `lg_migrated_${index + 1}`;
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
    indexById.set(groupId, fixtureIds);
  }
  return indexById;
}

function normalizeLightingLinks(rawLinks, fixtures, legacyGroupsById = new Map()) {
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
    const linkId = normalizeNonEmptyString(rawLink.id) ?? `lk_migrated_${index + 1}`;

    if (targetType === "lamp") {
      if (!lampIds.has(targetId)) {
        continue;
      }
      const edgeKey = `${switchId}|lamp|${targetId}`;
      if (dedupeKey.has(edgeKey)) {
        continue;
      }
      dedupeKey.add(edgeKey);
      links.push({
        id: linkId,
        switchId,
        targetType: "lamp",
        targetId
      });
      continue;
    }

    const groupLampIds = legacyGroupsById instanceof Map
      ? legacyGroupsById.get(targetId) ?? null
      : null;
    if (!Array.isArray(groupLampIds) || groupLampIds.length === 0) {
      continue;
    }
    for (let lampIndex = 0; lampIndex < groupLampIds.length; lampIndex += 1) {
      const lampId = groupLampIds[lampIndex];
      if (!lampIds.has(lampId)) {
        continue;
      }
      const edgeKey = `${switchId}|lamp|${lampId}`;
      if (dedupeKey.has(edgeKey)) {
        continue;
      }
      dedupeKey.add(edgeKey);
      links.push({
        id: lampIndex === 0 ? linkId : `${linkId}_${lampIndex + 1}`,
        switchId,
        targetType: "lamp",
        targetId: lampId
      });
    }
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
